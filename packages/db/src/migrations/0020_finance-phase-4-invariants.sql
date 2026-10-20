CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "finance_payment" ADD COLUMN "command_hash" text;--> statement-breakpoint
ALTER TABLE "finance_payment" ADD COLUMN "command_snapshot" jsonb;--> statement-breakpoint
UPDATE "finance_payment"
SET "command_hash" = 'legacy:' || "id",
    "command_snapshot" = jsonb_build_object('legacy', true, 'paymentId', "id")
WHERE "command_hash" IS NULL OR "command_snapshot" IS NULL;--> statement-breakpoint
ALTER TABLE "finance_payment" ALTER COLUMN "command_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_payment" ALTER COLUMN "command_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_payment" ADD CONSTRAINT "finance_payment_command_hash_check"
CHECK ("command_hash" ~ '^[a-f0-9]{64}$' OR "command_hash" LIKE 'legacy:%');--> statement-breakpoint
CREATE INDEX "admission_number_trgm_idx" ON "admission" USING gin ("admission_no" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "admission_name_trgm_idx" ON "admission" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "finance_bill_school_issue_idx" ON "finance_bill" USING btree ("school_id","issue_date","id");--> statement-breakpoint
CREATE INDEX "finance_bill_allocation_proposal_idx" ON "finance_bill" USING btree ("school_id","admission_id","currency","status","issue_date","bill_number","id");--> statement-breakpoint
CREATE INDEX "finance_bill_admission_number_trgm_idx" ON "finance_bill" USING gin ("admission_number_snapshot" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "finance_bill_admission_name_trgm_idx" ON "finance_bill" USING gin ("admission_name_snapshot" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "finance_bill_number_trgm_idx" ON "finance_bill" USING gin ("bill_number" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "finance_payment_school_received_idx" ON "finance_payment" USING btree ("school_id","received_at","id");--> statement-breakpoint
CREATE INDEX "finance_payment_reference_trgm_idx" ON "finance_payment" USING gin ("external_reference" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "finance_payment_receipt_trgm_idx" ON "finance_payment" USING gin ("receipt_number" gin_trgm_ops);--> statement-breakpoint

CREATE OR REPLACE FUNCTION "finance_validate_ledger_entry"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target "finance_ledger_entry"%ROWTYPE;
  specialized_id text;
  related_bill_id text;
  related_payment_id text;
  related_adjustment_kind finance_adjustment_kind;
  related_adjustment_amount bigint;
  related_bill_total bigint;
  related_bill_credits bigint;
  related_bill_debits bigint;
  related_bill_allocations bigint;
BEGIN
  IF NEW."type" = 'reversal' THEN
    SELECT * INTO target FROM "finance_ledger_entry"
    WHERE "id" = NEW."reversal_of_entry_id" AND "school_id" = NEW."school_id";
    IF NOT FOUND OR target."type" = 'reversal'
      OR target."admission_id" <> NEW."admission_id"
      OR target."session_id" <> NEW."session_id"
      OR target."currency" <> NEW."currency"
      OR target."amount_minor" <> NEW."amount_minor"
      OR target."direction" = NEW."direction" THEN
      RAISE EXCEPTION 'Reversal must exactly oppose one non-reversal ledger fact in the same account, session, and currency';
    END IF;

    SELECT "id" INTO specialized_id FROM "finance_payment" WHERE "ledger_entry_id" = target."id" FOR UPDATE;
    IF specialized_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM "finance_payment_allocation" a WHERE a."payment_id" = specialized_id)
      OR EXISTS (
        SELECT 1 FROM "finance_refund" r
        WHERE r."payment_id" = specialized_id
          AND NOT EXISTS (SELECT 1 FROM "finance_ledger_entry" rr WHERE rr."reversal_of_entry_id" = r."ledger_entry_id")
      )
    ) THEN
      RAISE EXCEPTION 'Payment with live settlement facts requires coordinated reversal';
    END IF;

    specialized_id := NULL;
    SELECT "id" INTO specialized_id FROM "finance_bill" WHERE "ledger_entry_id" = target."id" FOR UPDATE;
    IF specialized_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM "finance_payment_allocation" a WHERE a."bill_id" = specialized_id)
      OR EXISTS (
        SELECT 1 FROM "finance_adjustment" a
        WHERE a."bill_id" = specialized_id
          AND NOT EXISTS (SELECT 1 FROM "finance_ledger_entry" rr WHERE rr."reversal_of_entry_id" = a."ledger_entry_id")
      )
    ) THEN
      RAISE EXCEPTION 'Bill with live settlement facts requires coordinated reversal';
    END IF;

    SELECT "bill_id", "kind", "amount_minor" INTO related_bill_id, related_adjustment_kind, related_adjustment_amount
    FROM "finance_adjustment" WHERE "ledger_entry_id" = target."id" FOR UPDATE;
    IF related_bill_id IS NOT NULL THEN
      SELECT "total_amount_minor" INTO related_bill_total FROM "finance_bill" WHERE "id" = related_bill_id FOR UPDATE;
      IF related_adjustment_kind = 'debit_correction' THEN
        SELECT COALESCE(sum(a."amount_minor"), 0) INTO related_bill_credits FROM "finance_adjustment" a
        WHERE a."bill_id" = related_bill_id AND a."kind" IN ('discount','waiver','write_off','credit_correction')
          AND NOT EXISTS (SELECT 1 FROM "finance_ledger_entry" r WHERE r."reversal_of_entry_id" = a."ledger_entry_id");
        SELECT COALESCE(sum(a."amount_minor"), 0) INTO related_bill_debits FROM "finance_adjustment" a
        WHERE a."bill_id" = related_bill_id AND a."kind" = 'debit_correction'
          AND NOT EXISTS (SELECT 1 FROM "finance_ledger_entry" r WHERE r."reversal_of_entry_id" = a."ledger_entry_id");
        SELECT COALESCE(sum(a."amount_minor"), 0) INTO related_bill_allocations
        FROM "finance_payment_allocation" a WHERE a."bill_id" = related_bill_id;
        IF related_bill_credits + related_bill_allocations > related_bill_total + related_bill_debits - related_adjustment_amount THEN
          RAISE EXCEPTION 'Debit correction cannot be reversed while dependent bill settlements are live';
        END IF;
      END IF;
    END IF;
    SELECT "payment_id" INTO related_payment_id FROM "finance_refund" WHERE "ledger_entry_id" = target."id" FOR UPDATE;
    IF related_payment_id IS NOT NULL THEN
      PERFORM 1 FROM "finance_payment" WHERE "id" = related_payment_id FOR UPDATE;
    END IF;
  END IF;
  RETURN NEW;
END; $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "finance_validate_adjustment"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ledger "finance_ledger_entry"%ROWTYPE;
  bill "finance_bill"%ROWTYPE;
  line "finance_bill_line"%ROWTYPE;
  live_credits bigint;
  live_debits bigint;
  live_allocations bigint;
  line_credits bigint;
  line_debits bigint;
BEGIN
  SELECT * INTO ledger FROM "finance_ledger_entry" WHERE "id" = NEW."ledger_entry_id";
  IF NOT FOUND OR ledger."school_id" <> NEW."school_id" OR ledger."admission_id" <> NEW."admission_id"
    OR ledger."session_id" <> NEW."session_id" OR ledger."currency" <> NEW."currency"
    OR ledger."amount_minor" <> NEW."amount_minor" OR ledger."type"::text <> NEW."kind"::text
    OR ledger."direction" <> (CASE WHEN NEW."kind" = 'debit_correction' THEN 'debit'::finance_ledger_direction ELSE 'credit'::finance_ledger_direction END) THEN
    RAISE EXCEPTION 'Adjustment and ledger accounting identity do not match';
  END IF;

  IF NEW."bill_id" IS NOT NULL THEN
    SELECT * INTO bill FROM "finance_bill" WHERE "id" = NEW."bill_id" FOR UPDATE;
    IF NOT FOUND OR bill."status" <> 'posted'
      OR EXISTS (SELECT 1 FROM "finance_ledger_entry" r WHERE r."reversal_of_entry_id" = bill."ledger_entry_id") THEN
      RAISE EXCEPTION 'Bill adjustments require a posted, unreversed bill';
    END IF;
    IF NEW."bill_line_id" IS NOT NULL THEN
      SELECT * INTO line FROM "finance_bill_line"
      WHERE "id" = NEW."bill_line_id" AND "bill_id" = NEW."bill_id" FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Bill-line adjustment target does not belong to the bill'; END IF;
    END IF;

    SELECT COALESCE(sum(a."amount_minor"), 0) INTO live_credits
    FROM "finance_adjustment" a
    WHERE a."bill_id" = NEW."bill_id" AND a."kind" IN ('discount','waiver','write_off','credit_correction')
      AND NOT EXISTS (SELECT 1 FROM "finance_ledger_entry" r WHERE r."reversal_of_entry_id" = a."ledger_entry_id");
    SELECT COALESCE(sum(a."amount_minor"), 0) INTO live_debits
    FROM "finance_adjustment" a
    WHERE a."bill_id" = NEW."bill_id" AND a."kind" = 'debit_correction'
      AND NOT EXISTS (SELECT 1 FROM "finance_ledger_entry" r WHERE r."reversal_of_entry_id" = a."ledger_entry_id");
    SELECT COALESCE(sum(a."amount_minor"), 0) INTO live_allocations
    FROM "finance_payment_allocation" a WHERE a."bill_id" = NEW."bill_id";

    IF NEW."kind" IN ('discount','waiver','write_off','credit_correction')
      AND live_credits + live_allocations + NEW."amount_minor" > bill."total_amount_minor" + live_debits THEN
      RAISE EXCEPTION 'Bill-specific credits and allocations exceed bill total plus live debit corrections';
    END IF;

    IF NEW."bill_line_id" IS NOT NULL AND NEW."kind" IN ('discount','waiver','write_off','credit_correction') THEN
      SELECT COALESCE(sum(a."amount_minor"), 0) INTO line_credits
      FROM "finance_adjustment" a
      WHERE a."bill_line_id" = NEW."bill_line_id" AND a."kind" IN ('discount','waiver','write_off','credit_correction')
        AND NOT EXISTS (SELECT 1 FROM "finance_ledger_entry" r WHERE r."reversal_of_entry_id" = a."ledger_entry_id");
      SELECT COALESCE(sum(a."amount_minor"), 0) INTO line_debits
      FROM "finance_adjustment" a
      WHERE a."bill_line_id" = NEW."bill_line_id" AND a."kind" = 'debit_correction'
        AND NOT EXISTS (SELECT 1 FROM "finance_ledger_entry" r WHERE r."reversal_of_entry_id" = a."ledger_entry_id");
      IF line_credits + NEW."amount_minor" > line."amount_minor" + line_debits THEN
        RAISE EXCEPTION 'Bill-line credits exceed line amount plus live debit corrections';
      END IF;
    END IF;
  ELSIF NEW."kind" = 'debit_correction' THEN
    RAISE EXCEPTION 'Debit corrections require a posted, unreversed bill';
  ELSIF NEW."bill_line_id" IS NOT NULL THEN
    RAISE EXCEPTION 'Bill-line adjustment requires a bill';
  END IF;
  RETURN NEW;
END; $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "finance_validate_refund"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ledger "finance_ledger_entry"%ROWTYPE;
  paid bigint;
  allocated bigint;
  refunded bigint;
  payment_ledger text;
BEGIN
  SELECT "amount_minor", "ledger_entry_id" INTO paid, payment_ledger
  FROM "finance_payment" WHERE "id" = NEW."payment_id" FOR UPDATE;
  SELECT * INTO ledger FROM "finance_ledger_entry" WHERE "id" = NEW."ledger_entry_id";
  IF paid IS NULL OR NOT FOUND OR ledger."school_id" <> NEW."school_id" OR ledger."admission_id" <> NEW."admission_id"
    OR ledger."session_id" <> NEW."session_id" OR ledger."currency" <> NEW."currency"
    OR ledger."amount_minor" <> NEW."amount_minor" OR ledger."type" <> 'refund' OR ledger."direction" <> 'debit' THEN
    RAISE EXCEPTION 'Refund and ledger accounting identity do not match';
  END IF;
  IF EXISTS (SELECT 1 FROM "finance_ledger_entry" WHERE "reversal_of_entry_id" = payment_ledger) THEN
    RAISE EXCEPTION 'Reversed payments cannot be refunded';
  END IF;
  SELECT COALESCE(sum(a."amount_minor"), 0) INTO allocated
  FROM "finance_payment_allocation" a WHERE a."payment_id" = NEW."payment_id";
  SELECT COALESCE(sum(r."amount_minor"), 0) INTO refunded FROM "finance_refund" r
  WHERE r."payment_id" = NEW."payment_id"
    AND NOT EXISTS (SELECT 1 FROM "finance_ledger_entry" rr WHERE rr."reversal_of_entry_id" = r."ledger_entry_id");
  IF allocated + refunded + NEW."amount_minor" > paid THEN
    RAISE EXCEPTION 'Allocations and refunds exceed payment amount';
  END IF;
  RETURN NEW;
END; $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "finance_validate_allocation"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  payment_total bigint;
  bill_total bigint;
  allocated_payment bigint;
  refunded_payment bigint;
  allocated_bill bigint;
  bill_status finance_bill_status;
  payment_ledger text;
  bill_ledger text;
  bill_credits bigint;
  bill_debits bigint;
BEGIN
  SELECT "amount_minor", "ledger_entry_id" INTO payment_total, payment_ledger
  FROM "finance_payment" WHERE "id" = NEW."payment_id" FOR UPDATE;
  SELECT "total_amount_minor", "status", "ledger_entry_id" INTO bill_total, bill_status, bill_ledger
  FROM "finance_bill" WHERE "id" = NEW."bill_id" FOR UPDATE;
  IF payment_total IS NULL OR bill_total IS NULL OR bill_status <> 'posted' THEN
    RAISE EXCEPTION 'Allocations require an existing payment and finalized bill';
  END IF;
  IF EXISTS (SELECT 1 FROM "finance_ledger_entry" WHERE "reversal_of_entry_id" IN (payment_ledger, bill_ledger)) THEN
    RAISE EXCEPTION 'Reversed payments or bills cannot be allocated';
  END IF;
  SELECT COALESCE(sum(a."amount_minor"), 0) INTO bill_credits FROM "finance_adjustment" a
  WHERE a."bill_id" = NEW."bill_id" AND a."kind" IN ('discount','waiver','write_off','credit_correction')
    AND NOT EXISTS (SELECT 1 FROM "finance_ledger_entry" r WHERE r."reversal_of_entry_id" = a."ledger_entry_id");
  SELECT COALESCE(sum(a."amount_minor"), 0) INTO bill_debits FROM "finance_adjustment" a
  WHERE a."bill_id" = NEW."bill_id" AND a."kind" = 'debit_correction'
    AND NOT EXISTS (SELECT 1 FROM "finance_ledger_entry" r WHERE r."reversal_of_entry_id" = a."ledger_entry_id");
  SELECT COALESCE(sum("amount_minor"), 0) INTO allocated_payment FROM "finance_payment_allocation" WHERE "payment_id" = NEW."payment_id";
  SELECT COALESCE(sum(r."amount_minor"), 0) INTO refunded_payment FROM "finance_refund" r
  WHERE r."payment_id" = NEW."payment_id"
    AND NOT EXISTS (SELECT 1 FROM "finance_ledger_entry" rr WHERE rr."reversal_of_entry_id" = r."ledger_entry_id");
  SELECT COALESCE(sum("amount_minor"), 0) INTO allocated_bill FROM "finance_payment_allocation" WHERE "bill_id" = NEW."bill_id";
  IF allocated_payment + refunded_payment + NEW."amount_minor" > payment_total
    OR allocated_bill + bill_credits + NEW."amount_minor" > bill_total + bill_debits THEN
    RAISE EXCEPTION 'Allocation exceeds available payment or bill capacity';
  END IF;
  RETURN NEW;
END; $$;--> statement-breakpoint

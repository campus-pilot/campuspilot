CREATE TYPE "public"."finance_adjustment_kind" AS ENUM('discount', 'waiver', 'write_off', 'debit_correction', 'credit_correction');--> statement-breakpoint
CREATE TYPE "public"."finance_bill_run_kind" AS ENUM('regular', 'supplemental');--> statement-breakpoint
CREATE TYPE "public"."finance_bill_run_status" AS ENUM('posting', 'posted');--> statement-breakpoint
CREATE TYPE "public"."finance_bill_source_kind" AS ENUM('billing_run', 'manual');--> statement-breakpoint
CREATE TYPE "public"."finance_bill_status" AS ENUM('posting', 'posted');--> statement-breakpoint
CREATE TYPE "public"."finance_cadence" AS ENUM('monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."finance_ledger_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."finance_ledger_entry_type" AS ENUM('bill', 'manual_debit_adjustment', 'payment', 'discount', 'waiver', 'write_off', 'refund', 'debit_correction', 'credit_correction', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."finance_number_kind" AS ENUM('bill', 'receipt', 'refund');--> statement-breakpoint
CREATE TYPE "public"."finance_payment_method" AS ENUM('cash', 'bank_transfer', 'card', 'cheque', 'other');--> statement-breakpoint
CREATE TYPE "public"."finance_pricing_source_kind" AS ENUM('admission', 'class', 'session', 'run_class', 'run_session', 'fallback', 'manual');--> statement-breakpoint
CREATE TABLE "finance_adjustment" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"admission_id" text NOT NULL,
	"session_id" text NOT NULL,
	"ledger_entry_id" text NOT NULL,
	"bill_id" text,
	"bill_line_id" text,
	"kind" "finance_adjustment_kind" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"reason_code" text NOT NULL,
	"reason_note" text NOT NULL,
	"calculation_snapshot" jsonb NOT NULL,
	"approved_by" text,
	"idempotency_key" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_adjustment_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "finance_adjustment_ledger_unique" UNIQUE("ledger_entry_id"),
	CONSTRAINT "finance_adjustment_school_idempotency_unique" UNIQUE("school_id","idempotency_key"),
	CONSTRAINT "finance_adjustment_amount_positive_check" CHECK ("finance_adjustment"."amount_minor" > 0),
	CONSTRAINT "finance_adjustment_currency_check" CHECK ("currency" in ('AED','AUD','BDT','BHD','CAD','CLF','EUR','GBP','INR','JPY','KWD','LKR','NPR','PKR','QAR','SAR','SGD','USD')),
	CONSTRAINT "finance_adjustment_reason_check" CHECK (nullif(btrim("finance_adjustment"."reason_code"), '') is not null and nullif(btrim("finance_adjustment"."reason_note"), '') is not null),
	CONSTRAINT "finance_adjustment_line_requires_bill_check" CHECK ("finance_adjustment"."bill_line_id" is null or "finance_adjustment"."bill_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "finance_admission_balance" (
	"school_id" text NOT NULL,
	"admission_id" text NOT NULL,
	"currency" varchar(3) NOT NULL,
	"last_sequence" bigint NOT NULL,
	"debit_total_minor" bigint NOT NULL,
	"credit_total_minor" bigint NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_admission_balance_school_id_admission_id_currency_pk" PRIMARY KEY("school_id","admission_id","currency"),
	CONSTRAINT "finance_balance_currency_check" CHECK ("currency" in ('AED','AUD','BDT','BHD','CAD','CLF','EUR','GBP','INR','JPY','KWD','LKR','NPR','PKR','QAR','SAR','SGD','USD')),
	CONSTRAINT "finance_balance_totals_nonnegative_check" CHECK ("finance_admission_balance"."last_sequence" >= 0 and "finance_admission_balance"."debit_total_minor" >= 0 and "finance_admission_balance"."credit_total_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "finance_admission_session_activity" (
	"school_id" text NOT NULL,
	"admission_id" text NOT NULL,
	"session_id" text NOT NULL,
	"currency" varchar(3) NOT NULL,
	"last_sequence" bigint NOT NULL,
	"entry_count" bigint NOT NULL,
	"debit_total_minor" bigint NOT NULL,
	"credit_total_minor" bigint NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_admission_session_activity_school_id_admission_id_session_id_currency_pk" PRIMARY KEY("school_id","admission_id","session_id","currency"),
	CONSTRAINT "finance_activity_currency_check" CHECK ("currency" in ('AED','AUD','BDT','BHD','CAD','CLF','EUR','GBP','INR','JPY','KWD','LKR','NPR','PKR','QAR','SAR','SGD','USD')),
	CONSTRAINT "finance_activity_totals_nonnegative_check" CHECK ("finance_admission_session_activity"."last_sequence" >= 0 and "finance_admission_session_activity"."entry_count" >= 0 and "finance_admission_session_activity"."debit_total_minor" >= 0 and "finance_admission_session_activity"."credit_total_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "finance_bill_line" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"bill_id" text NOT NULL,
	"line_order" integer NOT NULL,
	"fee_element_slug" text NOT NULL,
	"fee_element_name" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"pricing_source_kind" "finance_pricing_source_kind" NOT NULL,
	"pricing_source_key" text,
	"pricing_rule_snapshot" jsonb NOT NULL,
	"manual_reason" text,
	CONSTRAINT "finance_bill_line_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "finance_bill_line_bill_order_unique" UNIQUE("bill_id","line_order"),
	CONSTRAINT "finance_bill_line_bill_identity_unique" UNIQUE("id","school_id","bill_id","currency"),
	CONSTRAINT "finance_bill_line_amount_nonnegative_check" CHECK ("finance_bill_line"."amount_minor" >= 0),
	CONSTRAINT "finance_bill_line_order_nonnegative_check" CHECK ("finance_bill_line"."line_order" >= 0),
	CONSTRAINT "finance_bill_line_currency_check" CHECK ("currency" in ('AED','AUD','BDT','BHD','CAD','CLF','EUR','GBP','INR','JPY','KWD','LKR','NPR','PKR','QAR','SAR','SGD','USD')),
	CONSTRAINT "finance_bill_line_manual_reason_check" CHECK ("finance_bill_line"."pricing_source_kind" <> 'manual' or nullif(btrim("finance_bill_line"."manual_reason"), '') is not null)
);
--> statement-breakpoint
CREATE TABLE "finance_bill_run" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"session_id" text NOT NULL,
	"kind" "finance_bill_run_kind" NOT NULL,
	"status" "finance_bill_run_status" DEFAULT 'posting' NOT NULL,
	"period_key" text NOT NULL,
	"period_start_date" date NOT NULL,
	"period_end_date" date NOT NULL,
	"period_start_at" timestamp with time zone NOT NULL,
	"period_end_at" timestamp with time zone NOT NULL,
	"issue_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"cadence" "finance_cadence" NOT NULL,
	"currency" varchar(3) NOT NULL,
	"config_hash" text NOT NULL,
	"config_snapshot" jsonb NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"total_amount_minor" bigint NOT NULL,
	"bill_count" integer NOT NULL,
	"supplemental_reason" text,
	"idempotency_key" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "finance_bill_run_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "finance_bill_run_identity_unique" UNIQUE("id","school_id","session_id","currency","period_key"),
	CONSTRAINT "finance_bill_run_school_idempotency_unique" UNIQUE("school_id","idempotency_key"),
	CONSTRAINT "finance_bill_run_period_order_check" CHECK ("finance_bill_run"."period_start_date" < "finance_bill_run"."period_end_date" and "finance_bill_run"."period_start_at" < "finance_bill_run"."period_end_at"),
	CONSTRAINT "finance_bill_run_total_nonnegative_check" CHECK ("finance_bill_run"."total_amount_minor" >= 0),
	CONSTRAINT "finance_bill_run_count_nonnegative_check" CHECK ("finance_bill_run"."bill_count" >= 0),
	CONSTRAINT "finance_bill_run_supplemental_reason_check" CHECK (("finance_bill_run"."kind" = 'supplemental' and nullif(btrim("finance_bill_run"."supplemental_reason"), '') is not null) or ("finance_bill_run"."kind" = 'regular' and "finance_bill_run"."supplemental_reason" is null)),
	CONSTRAINT "finance_bill_run_currency_check" CHECK ("currency" in ('AED','AUD','BDT','BHD','CAD','CLF','EUR','GBP','INR','JPY','KWD','LKR','NPR','PKR','QAR','SAR','SGD','USD')),
	CONSTRAINT "finance_bill_run_finalization_shape_check" CHECK (("finance_bill_run"."status" = 'posting' and "finance_bill_run"."finalized_at" is null) or ("finance_bill_run"."status" = 'posted' and "finance_bill_run"."finalized_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "finance_bill" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"admission_id" text NOT NULL,
	"session_id" text NOT NULL,
	"bill_run_id" text,
	"ledger_entry_id" text NOT NULL,
	"status" "finance_bill_status" DEFAULT 'posting' NOT NULL,
	"source_kind" "finance_bill_source_kind" NOT NULL,
	"bill_number" text NOT NULL,
	"issue_date" date NOT NULL,
	"period_key" text,
	"currency" varchar(3) NOT NULL,
	"total_amount_minor" bigint NOT NULL,
	"line_count" integer NOT NULL,
	"admission_number_snapshot" text NOT NULL,
	"admission_name_snapshot" text NOT NULL,
	"session_start_year_snapshot" integer NOT NULL,
	"session_end_year_snapshot" integer NOT NULL,
	"enrollment_id_snapshot" text,
	"class_id_snapshot" text,
	"class_slug_snapshot" text,
	"class_label_snapshot" text,
	"section_id_snapshot" text,
	"section_slug_snapshot" text,
	"section_label_snapshot" text,
	"roll_number_snapshot" integer,
	"config_hash" text,
	"manual_reason" text,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "finance_bill_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "finance_bill_identity_currency_unique" UNIQUE("id","school_id","admission_id","session_id","currency"),
	CONSTRAINT "finance_bill_id_school_currency_unique" UNIQUE("id","school_id","currency"),
	CONSTRAINT "finance_bill_allocation_identity_unique" UNIQUE("id","school_id","admission_id","currency"),
	CONSTRAINT "finance_bill_school_number_unique" UNIQUE("school_id","bill_number"),
	CONSTRAINT "finance_bill_ledger_entry_unique" UNIQUE("ledger_entry_id"),
	CONSTRAINT "finance_bill_total_positive_check" CHECK ("finance_bill"."total_amount_minor" > 0),
	CONSTRAINT "finance_bill_line_count_positive_check" CHECK ("finance_bill"."line_count" > 0),
	CONSTRAINT "finance_bill_currency_check" CHECK ("currency" in ('AED','AUD','BDT','BHD','CAD','CLF','EUR','GBP','INR','JPY','KWD','LKR','NPR','PKR','QAR','SAR','SGD','USD')),
	CONSTRAINT "finance_bill_source_shape_check" CHECK (("finance_bill"."source_kind" = 'billing_run' and "finance_bill"."bill_run_id" is not null and "finance_bill"."manual_reason" is null) or ("finance_bill"."source_kind" = 'manual' and "finance_bill"."bill_run_id" is null and nullif(btrim("finance_bill"."manual_reason"), '') is not null)),
	CONSTRAINT "finance_bill_finalization_shape_check" CHECK (("finance_bill"."status" = 'posting' and "finance_bill"."finalized_at" is null) or ("finance_bill"."status" = 'posted' and "finance_bill"."finalized_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "finance_ledger_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"admission_id" text NOT NULL,
	"session_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"type" "finance_ledger_entry_type" NOT NULL,
	"direction" "finance_ledger_direction" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" text NOT NULL,
	"note" text,
	"reversal_of_entry_id" text,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "finance_ledger_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "finance_ledger_identity_currency_unique" UNIQUE("id","school_id","admission_id","session_id","currency"),
	CONSTRAINT "finance_ledger_fact_identity_unique" UNIQUE("id","school_id","admission_id","session_id","currency","type","direction","amount_minor"),
	CONSTRAINT "finance_ledger_admission_currency_sequence_unique" UNIQUE("school_id","admission_id","currency","sequence"),
	CONSTRAINT "finance_ledger_school_type_idempotency_unique" UNIQUE("school_id","type","idempotency_key"),
	CONSTRAINT "finance_ledger_amount_positive_check" CHECK ("finance_ledger_entry"."amount_minor" > 0),
	CONSTRAINT "finance_ledger_sequence_positive_check" CHECK ("finance_ledger_entry"."sequence" > 0),
	CONSTRAINT "finance_ledger_currency_check" CHECK ("currency" in ('AED','AUD','BDT','BHD','CAD','CLF','EUR','GBP','INR','JPY','KWD','LKR','NPR','PKR','QAR','SAR','SGD','USD')),
	CONSTRAINT "finance_ledger_reversal_shape_check" CHECK (("finance_ledger_entry"."type" = 'reversal' and "finance_ledger_entry"."reversal_of_entry_id" is not null) or ("finance_ledger_entry"."type" <> 'reversal' and "finance_ledger_entry"."reversal_of_entry_id" is null)),
	CONSTRAINT "finance_ledger_direction_type_check" CHECK (("finance_ledger_entry"."type" in ('bill', 'manual_debit_adjustment', 'refund', 'debit_correction') and "finance_ledger_entry"."direction" = 'debit') or ("finance_ledger_entry"."type" in ('payment', 'discount', 'waiver', 'write_off', 'credit_correction') and "finance_ledger_entry"."direction" = 'credit') or "finance_ledger_entry"."type" = 'reversal')
);
--> statement-breakpoint
CREATE TABLE "finance_number_counter" (
	"school_id" text NOT NULL,
	"session_id" text NOT NULL,
	"kind" "finance_number_kind" NOT NULL,
	"fiscal_key" text NOT NULL,
	"next_value" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_number_counter_school_id_session_id_kind_pk" PRIMARY KEY("school_id","session_id","kind"),
	CONSTRAINT "finance_number_counter_positive_check" CHECK ("finance_number_counter"."next_value" > 0),
	CONSTRAINT "finance_number_counter_fiscal_key_check" CHECK (nullif(btrim("finance_number_counter"."fiscal_key"), '') is not null)
);
--> statement-breakpoint
CREATE TABLE "finance_payment_allocation" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"admission_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"bill_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_allocation_payment_bill_unique" UNIQUE("payment_id","bill_id"),
	CONSTRAINT "finance_allocation_amount_positive_check" CHECK ("finance_payment_allocation"."amount_minor" > 0),
	CONSTRAINT "finance_allocation_currency_check" CHECK ("currency" in ('AED','AUD','BDT','BHD','CAD','CLF','EUR','GBP','INR','JPY','KWD','LKR','NPR','PKR','QAR','SAR','SGD','USD'))
);
--> statement-breakpoint
CREATE TABLE "finance_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"admission_id" text NOT NULL,
	"session_id" text NOT NULL,
	"ledger_entry_id" text NOT NULL,
	"receipt_number" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"method" "finance_payment_method" NOT NULL,
	"external_reference" text,
	"payer_name" text,
	"received_at" timestamp with time zone NOT NULL,
	"note" text,
	"idempotency_key" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_payment_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "finance_payment_identity_currency_unique" UNIQUE("id","school_id","admission_id","session_id","currency"),
	CONSTRAINT "finance_payment_allocation_identity_unique" UNIQUE("id","school_id","admission_id","currency"),
	CONSTRAINT "finance_payment_school_receipt_unique" UNIQUE("school_id","receipt_number"),
	CONSTRAINT "finance_payment_ledger_unique" UNIQUE("ledger_entry_id"),
	CONSTRAINT "finance_payment_school_idempotency_unique" UNIQUE("school_id","idempotency_key"),
	CONSTRAINT "finance_payment_amount_positive_check" CHECK ("finance_payment"."amount_minor" > 0),
	CONSTRAINT "finance_payment_currency_check" CHECK ("currency" in ('AED','AUD','BDT','BHD','CAD','CLF','EUR','GBP','INR','JPY','KWD','LKR','NPR','PKR','QAR','SAR','SGD','USD'))
);
--> statement-breakpoint
CREATE TABLE "finance_refund" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"admission_id" text NOT NULL,
	"session_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"ledger_entry_id" text NOT NULL,
	"refund_number" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"method" "finance_payment_method" NOT NULL,
	"external_reference" text,
	"reason" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_refund_id_school_unique" UNIQUE("id","school_id"),
	CONSTRAINT "finance_refund_school_number_unique" UNIQUE("school_id","refund_number"),
	CONSTRAINT "finance_refund_ledger_unique" UNIQUE("ledger_entry_id"),
	CONSTRAINT "finance_refund_school_idempotency_unique" UNIQUE("school_id","idempotency_key"),
	CONSTRAINT "finance_refund_amount_positive_check" CHECK ("finance_refund"."amount_minor" > 0),
	CONSTRAINT "finance_refund_currency_check" CHECK ("currency" in ('AED','AUD','BDT','BHD','CAD','CLF','EUR','GBP','INR','JPY','KWD','LKR','NPR','PKR','QAR','SAR','SGD','USD')),
	CONSTRAINT "finance_refund_reason_check" CHECK (nullif(btrim("finance_refund"."reason"), '') is not null)
);
--> statement-breakpoint
ALTER TABLE "admission" ADD COLUMN "unregistered_at" timestamp with time zone;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "school_session" s
		WHERE s."finance_config" ? 'currency'
		AND COALESCE(s."finance_config" ->> 'currency', '') NOT IN ('AED','AUD','BDT','BHD','CAD','CLF','EUR','GBP','INR','JPY','KWD','LKR','NPR','PKR','QAR','SAR','SGD','USD')
	) THEN
		RAISE EXCEPTION 'Explicit legacy finance currency is unsupported';
	END IF;
	IF EXISTS (
		SELECT 1 FROM "admission"
		GROUP BY "school_id", "admission_no"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Cannot add school-scoped admission number uniqueness: exact duplicates exist';
	END IF;
	IF EXISTS (
		SELECT 1 FROM "admission"
		GROUP BY "school_id", lower(btrim("admission_no"))
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Cannot add school-scoped admission number uniqueness: case/trim variants exist';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "admission" ADD CONSTRAINT "admission_id_school_id_unique" UNIQUE("id","school_id");--> statement-breakpoint
ALTER TABLE "admission" ADD CONSTRAINT "admission_school_id_admission_no_unique" UNIQUE("school_id","admission_no");--> statement-breakpoint
ALTER TABLE "school_session" ADD CONSTRAINT "school_session_id_school_id_unique" UNIQUE("id","school_id");--> statement-breakpoint
ALTER TABLE "finance_adjustment" ADD CONSTRAINT "finance_adjustment_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_adjustment" ADD CONSTRAINT "finance_adjustment_admission_school_fk" FOREIGN KEY ("admission_id","school_id") REFERENCES "public"."admission"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_adjustment" ADD CONSTRAINT "finance_adjustment_session_school_fk" FOREIGN KEY ("session_id","school_id") REFERENCES "public"."school_session"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_adjustment" ADD CONSTRAINT "finance_adjustment_ledger_identity_fk" FOREIGN KEY ("ledger_entry_id","school_id","admission_id","session_id","currency") REFERENCES "public"."finance_ledger_entry"("id","school_id","admission_id","session_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_adjustment" ADD CONSTRAINT "finance_adjustment_bill_identity_fk" FOREIGN KEY ("bill_id","school_id","admission_id","session_id","currency") REFERENCES "public"."finance_bill"("id","school_id","admission_id","session_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_adjustment" ADD CONSTRAINT "finance_adjustment_line_school_fk" FOREIGN KEY ("bill_line_id","school_id","bill_id","currency") REFERENCES "public"."finance_bill_line"("id","school_id","bill_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_admission_balance" ADD CONSTRAINT "finance_admission_balance_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_admission_balance" ADD CONSTRAINT "finance_balance_admission_school_fk" FOREIGN KEY ("admission_id","school_id") REFERENCES "public"."admission"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_admission_session_activity" ADD CONSTRAINT "finance_admission_session_activity_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_admission_session_activity" ADD CONSTRAINT "finance_activity_admission_school_fk" FOREIGN KEY ("admission_id","school_id") REFERENCES "public"."admission"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_admission_session_activity" ADD CONSTRAINT "finance_activity_session_school_fk" FOREIGN KEY ("session_id","school_id") REFERENCES "public"."school_session"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_bill_line" ADD CONSTRAINT "finance_bill_line_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_bill_line" ADD CONSTRAINT "finance_bill_line_bill_school_fk" FOREIGN KEY ("bill_id","school_id","currency") REFERENCES "public"."finance_bill"("id","school_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_bill_run" ADD CONSTRAINT "finance_bill_run_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_bill_run" ADD CONSTRAINT "finance_bill_run_session_school_fk" FOREIGN KEY ("session_id","school_id") REFERENCES "public"."school_session"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_bill" ADD CONSTRAINT "finance_bill_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_bill" ADD CONSTRAINT "finance_bill_admission_school_fk" FOREIGN KEY ("admission_id","school_id") REFERENCES "public"."admission"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_bill" ADD CONSTRAINT "finance_bill_session_school_fk" FOREIGN KEY ("session_id","school_id") REFERENCES "public"."school_session"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_bill" ADD CONSTRAINT "finance_bill_run_school_fk" FOREIGN KEY ("bill_run_id","school_id") REFERENCES "public"."finance_bill_run"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_bill" ADD CONSTRAINT "finance_bill_ledger_identity_fk" FOREIGN KEY ("ledger_entry_id","school_id","admission_id","session_id","currency") REFERENCES "public"."finance_ledger_entry"("id","school_id","admission_id","session_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_ledger_entry" ADD CONSTRAINT "finance_ledger_entry_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_ledger_entry" ADD CONSTRAINT "finance_ledger_admission_school_fk" FOREIGN KEY ("admission_id","school_id") REFERENCES "public"."admission"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_ledger_entry" ADD CONSTRAINT "finance_ledger_session_school_fk" FOREIGN KEY ("session_id","school_id") REFERENCES "public"."school_session"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_ledger_entry" ADD CONSTRAINT "finance_ledger_reversal_school_fk" FOREIGN KEY ("reversal_of_entry_id","school_id") REFERENCES "public"."finance_ledger_entry"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_number_counter" ADD CONSTRAINT "finance_number_counter_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_number_counter" ADD CONSTRAINT "finance_number_counter_session_school_fk" FOREIGN KEY ("session_id","school_id") REFERENCES "public"."school_session"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_payment_allocation" ADD CONSTRAINT "finance_payment_allocation_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_payment_allocation" ADD CONSTRAINT "finance_allocation_payment_identity_fk" FOREIGN KEY ("payment_id","school_id","admission_id","currency") REFERENCES "public"."finance_payment"("id","school_id","admission_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_payment_allocation" ADD CONSTRAINT "finance_allocation_bill_identity_fk" FOREIGN KEY ("bill_id","school_id","admission_id","currency") REFERENCES "public"."finance_bill"("id","school_id","admission_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_payment" ADD CONSTRAINT "finance_payment_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_payment" ADD CONSTRAINT "finance_payment_admission_school_fk" FOREIGN KEY ("admission_id","school_id") REFERENCES "public"."admission"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_payment" ADD CONSTRAINT "finance_payment_session_school_fk" FOREIGN KEY ("session_id","school_id") REFERENCES "public"."school_session"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_payment" ADD CONSTRAINT "finance_payment_ledger_identity_fk" FOREIGN KEY ("ledger_entry_id","school_id","admission_id","session_id","currency") REFERENCES "public"."finance_ledger_entry"("id","school_id","admission_id","session_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_refund" ADD CONSTRAINT "finance_refund_school_id_school_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."school"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_refund" ADD CONSTRAINT "finance_refund_admission_school_fk" FOREIGN KEY ("admission_id","school_id") REFERENCES "public"."admission"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_refund" ADD CONSTRAINT "finance_refund_session_school_fk" FOREIGN KEY ("session_id","school_id") REFERENCES "public"."school_session"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_refund" ADD CONSTRAINT "finance_refund_payment_identity_fk" FOREIGN KEY ("payment_id","school_id","admission_id","session_id","currency") REFERENCES "public"."finance_payment"("id","school_id","admission_id","session_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_refund" ADD CONSTRAINT "finance_refund_ledger_identity_fk" FOREIGN KEY ("ledger_entry_id","school_id","admission_id","session_id","currency") REFERENCES "public"."finance_ledger_entry"("id","school_id","admission_id","session_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_adjustment_bill_idx" ON "finance_adjustment" USING btree ("school_id","bill_id");--> statement-breakpoint
CREATE INDEX "finance_activity_session_idx" ON "finance_admission_session_activity" USING btree ("school_id","session_id","currency");--> statement-breakpoint
CREATE INDEX "finance_bill_line_bill_idx" ON "finance_bill_line" USING btree ("school_id","bill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_bill_run_regular_period_unique" ON "finance_bill_run" USING btree ("school_id","session_id","period_key") WHERE "finance_bill_run"."kind" = 'regular';--> statement-breakpoint
CREATE INDEX "finance_bill_run_school_session_recorded_idx" ON "finance_bill_run" USING btree ("school_id","session_id","recorded_at","id");--> statement-breakpoint
CREATE INDEX "finance_bill_admission_issue_idx" ON "finance_bill" USING btree ("school_id","admission_id","issue_date","id");--> statement-breakpoint
CREATE INDEX "finance_bill_run_idx" ON "finance_bill" USING btree ("school_id","bill_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_ledger_reversal_target_unique" ON "finance_ledger_entry" USING btree ("school_id","reversal_of_entry_id") WHERE "finance_ledger_entry"."reversal_of_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "finance_ledger_admission_effective_idx" ON "finance_ledger_entry" USING btree ("school_id","admission_id","effective_at","sequence");--> statement-breakpoint
CREATE INDEX "finance_ledger_session_effective_idx" ON "finance_ledger_entry" USING btree ("school_id","session_id","effective_at","sequence");--> statement-breakpoint
CREATE INDEX "finance_allocation_bill_idx" ON "finance_payment_allocation" USING btree ("school_id","bill_id");--> statement-breakpoint
CREATE INDEX "finance_payment_admission_received_idx" ON "finance_payment" USING btree ("school_id","admission_id","received_at","id");--> statement-breakpoint
CREATE INDEX "finance_payment_reference_idx" ON "finance_payment" USING btree ("school_id","external_reference");--> statement-breakpoint
CREATE INDEX "finance_refund_payment_idx" ON "finance_refund" USING btree ("school_id","payment_id");--> statement-breakpoint
CREATE INDEX "admission_school_id_registered_idx" ON "admission" USING btree ("school_id","registered");--> statement-breakpoint
CREATE FUNCTION "finance_major_json_to_minor"("value" jsonb, "currency_code" text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
CALLED ON NULL INPUT
AS $$
DECLARE
	major_value numeric;
	minor_value numeric;
	minor_factor numeric;
BEGIN
	IF "currency_code" IS NULL OR "currency_code" NOT IN ('AED','AUD','BDT','BHD','CAD','CLF','EUR','GBP','INR','JPY','KWD','LKR','NPR','PKR','QAR','SAR','SGD','USD') THEN
		RAISE EXCEPTION 'Legacy finance amount requires an explicit supported currency';
	END IF;
	IF "value" IS NULL OR jsonb_typeof("value") <> 'number' THEN
		RAISE EXCEPTION 'Legacy finance amount must be a JSON number';
	END IF;

	major_value := ("value" #>> '{}')::numeric;
	minor_factor := CASE
		WHEN "currency_code" = 'JPY' THEN 1
		WHEN "currency_code" IN ('BHD','KWD') THEN 1000
		WHEN "currency_code" = 'CLF' THEN 10000
		ELSE 100
	END;
	minor_value := major_value * minor_factor;

	IF major_value < 0 OR minor_value <> trunc(minor_value) THEN
		RAISE EXCEPTION 'Legacy finance amount cannot be represented exactly in minor units';
	END IF;
	IF minor_value > 9007199254740991 THEN
		RAISE EXCEPTION 'Legacy finance amount exceeds the exact JSON integer range';
	END IF;

	RETURN to_jsonb(minor_value::bigint);
END;
$$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "admission" a
		CROSS JOIN LATERAL jsonb_object_keys(a."finance_config") session_id
		LEFT JOIN "school_session" s
			ON s."id" = session_id AND s."school_id" = a."school_id"
		WHERE a."finance_config" <> '{}'::jsonb AND s."id" IS NULL
	) THEN
		RAISE EXCEPTION 'Admission finance overrides reference a missing or cross-school session';
	END IF;

	IF EXISTS (
		SELECT 1 FROM "school_session" s
		CROSS JOIN LATERAL jsonb_each(COALESCE(s."finance_config" -> 'elements', '{}'::jsonb)) element
		WHERE element.value ? 'defaultValue'
		AND COALESCE(s."finance_config" ->> 'currency', '') NOT IN ('AED','AUD','BDT','BHD','CAD','CLF','EUR','GBP','INR','JPY','KWD','LKR','NPR','PKR','QAR','SAR','SGD','USD')
	) OR EXISTS (
		SELECT 1 FROM "school_session" s
		CROSS JOIN LATERAL jsonb_each(s."finance_class_overrides") class_values
		CROSS JOIN LATERAL jsonb_each(class_values.value) fee_value
		WHERE COALESCE(s."finance_config" ->> 'currency', '') NOT IN ('AED','AUD','BDT','BHD','CAD','CLF','EUR','GBP','INR','JPY','KWD','LKR','NPR','PKR','QAR','SAR','SGD','USD')
	) OR EXISTS (
		SELECT 1 FROM "admission" a
		CROSS JOIN LATERAL jsonb_each(a."finance_config") session_values
		CROSS JOIN LATERAL jsonb_each(session_values.value) fee_value
		JOIN "school_session" s ON s."id" = session_values.key AND s."school_id" = a."school_id"
		WHERE COALESCE(s."finance_config" ->> 'currency', '') NOT IN ('AED','AUD','BDT','BHD','CAD','CLF','EUR','GBP','INR','JPY','KWD','LKR','NPR','PKR','QAR','SAR','SGD','USD')
	) THEN
		RAISE EXCEPTION 'Every legacy amount-bearing finance configuration requires an explicit supported currency';
	END IF;
END $$;--> statement-breakpoint
UPDATE "school_session" s
SET "finance_config" = jsonb_set(
	s."finance_config",
	'{elements}',
	COALESCE((
		SELECT jsonb_object_agg(
			element.key,
			CASE WHEN element.value ? 'defaultValue' THEN
				(element.value - 'defaultValue') || jsonb_build_object(
					'defaultAmountMinor',
					finance_major_json_to_minor(element.value -> 'defaultValue', s."finance_config" ->> 'currency')
				)
			ELSE element.value END
		)
		FROM jsonb_each(s."finance_config" -> 'elements') element
	), '{}'::jsonb)
)
WHERE s."finance_config" IS NOT NULL;--> statement-breakpoint
UPDATE "school_session" s
SET "finance_class_overrides" = COALESCE((
	SELECT jsonb_object_agg(
		class_values.key,
		COALESCE((
			SELECT jsonb_object_agg(
				fee_value.key,
				finance_major_json_to_minor(fee_value.value, s."finance_config" ->> 'currency')
			)
			FROM jsonb_each(class_values.value) fee_value
		), '{}'::jsonb)
	)
	FROM jsonb_each(s."finance_class_overrides") class_values
), '{}'::jsonb)
WHERE s."finance_class_overrides" <> '{}'::jsonb;--> statement-breakpoint
UPDATE "admission" a
SET "finance_config" = COALESCE((
	SELECT jsonb_object_agg(
		session_values.key,
		COALESCE((
			SELECT jsonb_object_agg(
				fee_value.key,
				finance_major_json_to_minor(fee_value.value, s."finance_config" ->> 'currency')
			)
			FROM jsonb_each(session_values.value) fee_value
		), '{}'::jsonb)
	)
	FROM jsonb_each(a."finance_config") session_values
	JOIN "school_session" s ON s."id" = session_values.key AND s."school_id" = a."school_id"
), '{}'::jsonb)
WHERE a."finance_config" <> '{}'::jsonb;--> statement-breakpoint
DROP FUNCTION "finance_major_json_to_minor"(jsonb, text);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "finance_validate_ledger_entry"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target "finance_ledger_entry"%ROWTYPE; specialized_id text;
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
		IF specialized_id IS NOT NULL AND (EXISTS (SELECT 1 FROM "finance_payment_allocation" a WHERE a."payment_id" = specialized_id)
			OR EXISTS (SELECT 1 FROM "finance_refund" r WHERE r."payment_id" = specialized_id AND NOT EXISTS (SELECT 1 FROM "finance_ledger_entry" rr WHERE rr."reversal_of_entry_id" = r."ledger_entry_id"))) THEN
			RAISE EXCEPTION 'Payment with live settlement facts requires coordinated reversal';
		END IF;
		specialized_id := NULL;
		SELECT "id" INTO specialized_id FROM "finance_bill" WHERE "ledger_entry_id" = target."id" FOR UPDATE;
		IF specialized_id IS NOT NULL AND (EXISTS (SELECT 1 FROM "finance_payment_allocation" a WHERE a."bill_id" = specialized_id)
			OR EXISTS (SELECT 1 FROM "finance_adjustment" a WHERE a."bill_id" = specialized_id AND a."kind" IN ('discount','waiver','write_off','credit_correction') AND NOT EXISTS (SELECT 1 FROM "finance_ledger_entry" rr WHERE rr."reversal_of_entry_id" = a."ledger_entry_id"))) THEN
			RAISE EXCEPTION 'Bill with live settlement facts requires coordinated reversal';
		END IF;
	END IF;
	RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER "finance_ledger_entry_validate" BEFORE INSERT ON "finance_ledger_entry" FOR EACH ROW EXECUTE FUNCTION "finance_validate_ledger_entry"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "finance_validate_bill"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ledger "finance_ledger_entry"%ROWTYPE; run "finance_bill_run"%ROWTYPE;
BEGIN
	IF NEW."status" <> 'posting' OR NEW."finalized_at" IS NOT NULL THEN
		RAISE EXCEPTION 'Bills must be inserted in posting state and finalized through the validated transition';
	END IF;
	SELECT * INTO ledger FROM "finance_ledger_entry" WHERE "id" = NEW."ledger_entry_id";
	IF NOT FOUND OR ledger."school_id" <> NEW."school_id" OR ledger."admission_id" <> NEW."admission_id"
		OR ledger."session_id" <> NEW."session_id" OR ledger."currency" <> NEW."currency"
		OR ledger."amount_minor" <> NEW."total_amount_minor" OR ledger."direction" <> 'debit'
		OR ledger."type" <> (CASE WHEN NEW."source_kind" = 'billing_run' THEN 'bill'::finance_ledger_entry_type ELSE 'manual_debit_adjustment'::finance_ledger_entry_type END) THEN
		RAISE EXCEPTION 'Bill and ledger accounting identity do not match';
	END IF;
	IF NEW."source_kind" = 'billing_run' THEN
		SELECT * INTO run FROM "finance_bill_run" WHERE "id" = NEW."bill_run_id" FOR UPDATE;
		IF NOT FOUND OR run."status" <> 'posting' OR run."school_id" <> NEW."school_id"
			OR run."session_id" <> NEW."session_id" OR run."currency" <> NEW."currency"
			OR run."period_key" <> NEW."period_key" THEN
			RAISE EXCEPTION 'Billing-run bill identity does not match its open run';
		END IF;
	END IF;
	RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER "finance_bill_validate" BEFORE INSERT ON "finance_bill" FOR EACH ROW EXECUTE FUNCTION "finance_validate_bill"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "finance_validate_bill_line"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bill "finance_bill"%ROWTYPE;
BEGIN
	SELECT * INTO bill FROM "finance_bill" WHERE "id" = NEW."bill_id" FOR UPDATE;
	IF NOT FOUND OR bill."status" <> 'posting' OR bill."school_id" <> NEW."school_id" OR bill."currency" <> NEW."currency" THEN
		RAISE EXCEPTION 'Bill lines may only be appended to their matching open bill';
	END IF;
	RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER "finance_bill_line_validate" BEFORE INSERT ON "finance_bill_line" FOR EACH ROW EXECUTE FUNCTION "finance_validate_bill_line"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "finance_validate_payment"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ledger "finance_ledger_entry"%ROWTYPE;
BEGIN
	SELECT * INTO ledger FROM "finance_ledger_entry" WHERE "id" = NEW."ledger_entry_id";
	IF NOT FOUND OR ledger."school_id" <> NEW."school_id" OR ledger."admission_id" <> NEW."admission_id"
		OR ledger."session_id" <> NEW."session_id" OR ledger."currency" <> NEW."currency"
		OR ledger."amount_minor" <> NEW."amount_minor" OR ledger."type" <> 'payment' OR ledger."direction" <> 'credit' THEN
		RAISE EXCEPTION 'Payment and ledger accounting identity do not match';
	END IF;
	RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER "finance_payment_validate" BEFORE INSERT ON "finance_payment" FOR EACH ROW EXECUTE FUNCTION "finance_validate_payment"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "finance_validate_adjustment"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ledger "finance_ledger_entry"%ROWTYPE; bill "finance_bill"%ROWTYPE; live_credits bigint; live_allocations bigint;
BEGIN
	SELECT * INTO ledger FROM "finance_ledger_entry" WHERE "id" = NEW."ledger_entry_id";
	IF NOT FOUND OR ledger."school_id" <> NEW."school_id" OR ledger."admission_id" <> NEW."admission_id"
		OR ledger."session_id" <> NEW."session_id" OR ledger."currency" <> NEW."currency"
		OR ledger."amount_minor" <> NEW."amount_minor" OR ledger."type"::text <> NEW."kind"::text
		OR ledger."direction" <> (CASE WHEN NEW."kind" = 'debit_correction' THEN 'debit'::finance_ledger_direction ELSE 'credit'::finance_ledger_direction END) THEN
		RAISE EXCEPTION 'Adjustment and ledger accounting identity do not match';
	END IF;
	IF NEW."bill_id" IS NOT NULL AND NEW."kind" IN ('discount','waiver','write_off','credit_correction') THEN
		SELECT * INTO bill FROM "finance_bill" WHERE "id" = NEW."bill_id" FOR UPDATE;
		IF NOT FOUND OR bill."status" <> 'posted' OR EXISTS (SELECT 1 FROM "finance_ledger_entry" r WHERE r."reversal_of_entry_id" = bill."ledger_entry_id") THEN
			RAISE EXCEPTION 'Bill-specific credits require a posted, unreversed bill';
		END IF;
		SELECT COALESCE(sum(a."amount_minor"), 0) INTO live_credits FROM "finance_adjustment" a WHERE a."bill_id" = NEW."bill_id" AND a."kind" IN ('discount','waiver','write_off','credit_correction') AND NOT EXISTS (SELECT 1 FROM "finance_ledger_entry" r WHERE r."reversal_of_entry_id" = a."ledger_entry_id");
		SELECT COALESCE(sum(a."amount_minor"), 0) INTO live_allocations FROM "finance_payment_allocation" a WHERE a."bill_id" = NEW."bill_id";
		IF live_credits + live_allocations + NEW."amount_minor" > bill."total_amount_minor" THEN
			RAISE EXCEPTION 'Bill-specific credits and allocations exceed bill total';
		END IF;
	END IF;
	RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER "finance_adjustment_validate" BEFORE INSERT ON "finance_adjustment" FOR EACH ROW EXECUTE FUNCTION "finance_validate_adjustment"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "finance_validate_refund"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ledger "finance_ledger_entry"%ROWTYPE; paid bigint; refunded bigint; payment_ledger text;
BEGIN
	SELECT "amount_minor", "ledger_entry_id" INTO paid, payment_ledger FROM "finance_payment" WHERE "id" = NEW."payment_id" FOR UPDATE;
	SELECT * INTO ledger FROM "finance_ledger_entry" WHERE "id" = NEW."ledger_entry_id";
	IF paid IS NULL OR NOT FOUND OR ledger."school_id" <> NEW."school_id" OR ledger."admission_id" <> NEW."admission_id"
		OR ledger."session_id" <> NEW."session_id" OR ledger."currency" <> NEW."currency"
		OR ledger."amount_minor" <> NEW."amount_minor" OR ledger."type" <> 'refund' OR ledger."direction" <> 'debit' THEN
		RAISE EXCEPTION 'Refund and ledger accounting identity do not match';
	END IF;
	IF EXISTS (SELECT 1 FROM "finance_ledger_entry" WHERE "reversal_of_entry_id" = payment_ledger) THEN
		RAISE EXCEPTION 'Reversed payments cannot be refunded';
	END IF;
	SELECT COALESCE(sum(r."amount_minor"), 0) INTO refunded FROM "finance_refund" r
	WHERE r."payment_id" = NEW."payment_id"
	AND NOT EXISTS (SELECT 1 FROM "finance_ledger_entry" rr WHERE rr."reversal_of_entry_id" = r."ledger_entry_id");
	IF refunded + NEW."amount_minor" > paid THEN RAISE EXCEPTION 'Refunds exceed payment amount'; END IF;
	RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER "finance_refund_validate" BEFORE INSERT ON "finance_refund" FOR EACH ROW EXECUTE FUNCTION "finance_validate_refund"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "finance_validate_allocation"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment_total bigint; bill_total bigint; allocated_payment bigint; allocated_bill bigint; bill_status finance_bill_status; payment_ledger text; bill_ledger text; bill_credits bigint;
BEGIN
	SELECT "amount_minor", "ledger_entry_id" INTO payment_total, payment_ledger FROM "finance_payment" WHERE "id" = NEW."payment_id" FOR UPDATE;
	SELECT "total_amount_minor", "status", "ledger_entry_id" INTO bill_total, bill_status, bill_ledger FROM "finance_bill" WHERE "id" = NEW."bill_id" FOR UPDATE;
	IF payment_total IS NULL OR bill_total IS NULL OR bill_status <> 'posted' THEN
		RAISE EXCEPTION 'Allocations require an existing payment and finalized bill';
	END IF;
	IF EXISTS (SELECT 1 FROM "finance_ledger_entry" WHERE "reversal_of_entry_id" IN (payment_ledger, bill_ledger)) THEN
		RAISE EXCEPTION 'Reversed payments or bills cannot be allocated';
	END IF;
	SELECT COALESCE(sum(a."amount_minor"), 0) INTO bill_credits FROM "finance_adjustment" a
	WHERE a."bill_id" = NEW."bill_id" AND a."kind" IN ('discount','waiver','write_off','credit_correction')
	AND NOT EXISTS (SELECT 1 FROM "finance_ledger_entry" r WHERE r."reversal_of_entry_id" = a."ledger_entry_id");
	SELECT COALESCE(sum("amount_minor"), 0) INTO allocated_payment FROM "finance_payment_allocation" WHERE "payment_id" = NEW."payment_id";
	SELECT COALESCE(sum("amount_minor"), 0) INTO allocated_bill FROM "finance_payment_allocation" WHERE "bill_id" = NEW."bill_id";
	IF allocated_payment + NEW."amount_minor" > payment_total OR allocated_bill + NEW."amount_minor" > bill_total - bill_credits THEN
		RAISE EXCEPTION 'Allocation exceeds available payment or bill amount';
	END IF;
	RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER "finance_allocation_validate" BEFORE INSERT ON "finance_payment_allocation" FOR EACH ROW EXECUTE FUNCTION "finance_validate_allocation"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "finance_validate_run_insert"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."status" <> 'posting' OR NEW."finalized_at" IS NOT NULL THEN
		RAISE EXCEPTION 'Bill runs must be inserted in posting state and finalized through the validated transition';
	END IF;
	RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER "finance_bill_run_insert_guard" BEFORE INSERT ON "finance_bill_run" FOR EACH ROW EXECUTE FUNCTION "finance_validate_run_insert"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "finance_guard_bill_finalization"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_count bigint; actual_total bigint;
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD."status" = 'posted' THEN RAISE EXCEPTION 'Posted bills are immutable'; END IF;
		RETURN OLD;
	END IF;
	IF OLD."status" <> 'posting' OR NEW."status" <> 'posted'
		OR NEW."finalized_at" IS NULL
		OR (to_jsonb(NEW) - 'status' - 'finalized_at') <> (to_jsonb(OLD) - 'status' - 'finalized_at') THEN
		RAISE EXCEPTION 'Only the posting-to-posted bill finalization transition is allowed';
	END IF;
	SELECT count(*), COALESCE(sum("amount_minor"), 0) INTO actual_count, actual_total FROM "finance_bill_line" WHERE "bill_id" = OLD."id";
	IF actual_count <> NEW."line_count" OR actual_total <> NEW."total_amount_minor" THEN
		RAISE EXCEPTION 'Bill header does not reconcile to its immutable lines';
	END IF;
	RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER "finance_bill_finalize_guard" BEFORE UPDATE OR DELETE ON "finance_bill" FOR EACH ROW EXECUTE FUNCTION "finance_guard_bill_finalization"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "finance_guard_run_finalization"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual_count bigint; actual_total bigint; open_count bigint;
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD."status" = 'posted' THEN RAISE EXCEPTION 'Posted bill runs are immutable'; END IF;
		RETURN OLD;
	END IF;
	IF OLD."status" <> 'posting' OR NEW."status" <> 'posted'
		OR NEW."finalized_at" IS NULL
		OR (to_jsonb(NEW) - 'status' - 'finalized_at') <> (to_jsonb(OLD) - 'status' - 'finalized_at') THEN
		RAISE EXCEPTION 'Only the posting-to-posted run finalization transition is allowed';
	END IF;
	SELECT count(*), COALESCE(sum("total_amount_minor"), 0), count(*) FILTER (WHERE "status" <> 'posted')
	INTO actual_count, actual_total, open_count FROM "finance_bill" WHERE "bill_run_id" = OLD."id";
	IF open_count <> 0 OR actual_count <> NEW."bill_count" OR actual_total <> NEW."total_amount_minor" THEN
		RAISE EXCEPTION 'Bill run header does not reconcile to finalized member bills';
	END IF;
	RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER "finance_bill_run_finalize_guard" BEFORE UPDATE OR DELETE ON "finance_bill_run" FOR EACH ROW EXECUTE FUNCTION "finance_guard_run_finalization"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "finance_reject_fact_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'Finance facts are append-only; post a correction or reversal instead';
END; $$;--> statement-breakpoint
CREATE TRIGGER "finance_ledger_entry_immutable" BEFORE UPDATE OR DELETE ON "finance_ledger_entry" FOR EACH ROW EXECUTE FUNCTION "finance_reject_fact_mutation"();--> statement-breakpoint
CREATE TRIGGER "finance_bill_line_immutable" BEFORE UPDATE OR DELETE ON "finance_bill_line" FOR EACH ROW EXECUTE FUNCTION "finance_reject_fact_mutation"();--> statement-breakpoint
CREATE TRIGGER "finance_payment_immutable" BEFORE UPDATE OR DELETE ON "finance_payment" FOR EACH ROW EXECUTE FUNCTION "finance_reject_fact_mutation"();--> statement-breakpoint
CREATE TRIGGER "finance_payment_allocation_immutable" BEFORE UPDATE OR DELETE ON "finance_payment_allocation" FOR EACH ROW EXECUTE FUNCTION "finance_reject_fact_mutation"();--> statement-breakpoint
CREATE TRIGGER "finance_adjustment_immutable" BEFORE UPDATE OR DELETE ON "finance_adjustment" FOR EACH ROW EXECUTE FUNCTION "finance_reject_fact_mutation"();--> statement-breakpoint
CREATE TRIGGER "finance_refund_immutable" BEFORE UPDATE OR DELETE ON "finance_refund" FOR EACH ROW EXECUTE FUNCTION "finance_reject_fact_mutation"();

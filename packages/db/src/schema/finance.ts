import { relations, sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { generateId } from "../id";
import { admissionTable } from "./admission";
import { schoolTable } from "./school";
import { schoolSessionTable } from "./session";

export const financeCadenceEnum = pgEnum("finance_cadence", [
  "monthly",
  "quarterly",
  "yearly",
]);
export const financeBillRunKindEnum = pgEnum("finance_bill_run_kind", [
  "regular",
  "supplemental",
]);
export const financeBillRunStatusEnum = pgEnum("finance_bill_run_status", [
  "posting",
  "posted",
]);
export const financeBillStatusEnum = pgEnum("finance_bill_status", [
  "posting",
  "posted",
]);
export const financeLedgerEntryTypeEnum = pgEnum(
  "finance_ledger_entry_type",
  [
    "bill",
    "manual_debit_adjustment",
    "payment",
    "discount",
    "waiver",
    "write_off",
    "refund",
    "debit_correction",
    "credit_correction",
    "reversal",
  ],
);
export const financeLedgerDirectionEnum = pgEnum("finance_ledger_direction", [
  "debit",
  "credit",
]);
export const financeBillSourceKindEnum = pgEnum("finance_bill_source_kind", [
  "billing_run",
  "manual",
]);
export const financePricingSourceKindEnum = pgEnum(
  "finance_pricing_source_kind",
  [
    "admission",
    "class",
    "session",
    "run_class",
    "run_session",
    "fallback",
    "manual",
  ],
);
export const financePaymentMethodEnum = pgEnum("finance_payment_method", [
  "cash",
  "bank_transfer",
  "card",
  "cheque",
  "other",
]);
export const financeAdjustmentKindEnum = pgEnum("finance_adjustment_kind", [
  "discount",
  "waiver",
  "write_off",
  "debit_correction",
  "credit_correction",
]);
export const financeNumberKindEnum = pgEnum("finance_number_kind", [
  "bill",
  "receipt",
  "refund",
]);

type JsonSnapshot = Record<string, unknown>;

const currencyCheck = (column: { name: string }) =>
  sql`${sql.identifier(column.name)} in ('AED','AUD','BDT','BHD','CAD','CLF','EUR','GBP','INR','JPY','KWD','LKR','NPR','PKR','QAR','SAR','SGD','USD')`;

/**
 * Header finalized atomically after every bill is finalized. Database guards
 * allow only the one-way posting -> posted transition and reject later members.
 */
export const financeBillRunTable = pgTable(
  "finance_bill_run",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("financeBillRun")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    sessionId: text("session_id").notNull(),
    kind: financeBillRunKindEnum("kind").notNull(),
    status: financeBillRunStatusEnum("status").notNull().default("posting"),
    periodKey: text("period_key").notNull(),
    periodStartDate: date("period_start_date").notNull(),
    periodEndDate: date("period_end_date").notNull(),
    periodStartAt: timestamp("period_start_at", { withTimezone: true }).notNull(),
    periodEndAt: timestamp("period_end_at", { withTimezone: true }).notNull(),
    issueDate: date("issue_date").notNull(),
    timeZone: text("time_zone").notNull(),
    cadence: financeCadenceEnum("cadence").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    configHash: text("config_hash").notNull(),
    configSnapshot: jsonb("config_snapshot").$type<JsonSnapshot>().notNull(),
    inputSnapshot: jsonb("input_snapshot").$type<JsonSnapshot>().notNull(),
    totalAmountMinor: bigint("total_amount_minor", { mode: "bigint" }).notNull(),
    billCount: integer("bill_count").notNull(),
    supplementalReason: text("supplemental_reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    recordedBy: text("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (table) => [
    unique("finance_bill_run_id_school_unique").on(table.id, table.schoolId),
    unique("finance_bill_run_identity_unique").on(
      table.id,
      table.schoolId,
      table.sessionId,
      table.currency,
      table.periodKey,
    ),
    unique("finance_bill_run_school_idempotency_unique").on(
      table.schoolId,
      table.idempotencyKey,
    ),
    uniqueIndex("finance_bill_run_regular_period_unique")
      .on(table.schoolId, table.sessionId, table.periodKey)
      .where(sql`${table.kind} = 'regular'`),
    foreignKey({
      name: "finance_bill_run_session_school_fk",
      columns: [table.sessionId, table.schoolId],
      foreignColumns: [schoolSessionTable.id, schoolSessionTable.schoolId],
    }),
    check(
      "finance_bill_run_period_order_check",
      sql`${table.periodStartDate} < ${table.periodEndDate} and ${table.periodStartAt} < ${table.periodEndAt}`,
    ),
    check(
      "finance_bill_run_total_nonnegative_check",
      sql`${table.totalAmountMinor} >= 0`,
    ),
    check("finance_bill_run_count_nonnegative_check", sql`${table.billCount} >= 0`),
    check(
      "finance_bill_run_supplemental_reason_check",
      sql`(${table.kind} = 'supplemental' and nullif(btrim(${table.supplementalReason}), '') is not null) or (${table.kind} = 'regular' and ${table.supplementalReason} is null)`,
    ),
    check("finance_bill_run_currency_check", currencyCheck(table.currency)),
    check(
      "finance_bill_run_finalization_shape_check",
      sql`(${table.status} = 'posting' and ${table.finalizedAt} is null) or (${table.status} = 'posted' and ${table.finalizedAt} is not null)`,
    ),
    index("finance_bill_run_school_session_recorded_idx").on(
      table.schoolId,
      table.sessionId,
      table.recordedAt,
      table.id,
    ),
  ],
);

/** Append-only accounting fact. Amounts are positive; direction carries sign. */
export const financeLedgerEntryTable = pgTable(
  "finance_ledger_entry",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("financeLedgerEntry")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    admissionId: text("admission_id").notNull(),
    sessionId: text("session_id").notNull(),
    sequence: bigint("sequence", { mode: "bigint" }).notNull(),
    type: financeLedgerEntryTypeEnum("type").notNull(),
    direction: financeLedgerDirectionEnum("direction").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    recordedBy: text("recorded_by").notNull(),
    note: text("note"),
    reversalOfEntryId: text("reversal_of_entry_id"),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (table) => [
    unique("finance_ledger_id_school_unique").on(table.id, table.schoolId),
    unique("finance_ledger_identity_currency_unique").on(
      table.id,
      table.schoolId,
      table.admissionId,
      table.sessionId,
      table.currency,
    ),
    unique("finance_ledger_fact_identity_unique").on(
      table.id,
      table.schoolId,
      table.admissionId,
      table.sessionId,
      table.currency,
      table.type,
      table.direction,
      table.amountMinor,
    ),
    unique("finance_ledger_admission_currency_sequence_unique").on(
      table.schoolId,
      table.admissionId,
      table.currency,
      table.sequence,
    ),
    unique("finance_ledger_school_type_idempotency_unique").on(
      table.schoolId,
      table.type,
      table.idempotencyKey,
    ),
    uniqueIndex("finance_ledger_reversal_target_unique")
      .on(table.schoolId, table.reversalOfEntryId)
      .where(sql`${table.reversalOfEntryId} is not null`),
    foreignKey({
      name: "finance_ledger_admission_school_fk",
      columns: [table.admissionId, table.schoolId],
      foreignColumns: [admissionTable.id, admissionTable.schoolId],
    }),
    foreignKey({
      name: "finance_ledger_session_school_fk",
      columns: [table.sessionId, table.schoolId],
      foreignColumns: [schoolSessionTable.id, schoolSessionTable.schoolId],
    }),
    foreignKey({
      name: "finance_ledger_reversal_school_fk",
      columns: [table.reversalOfEntryId, table.schoolId],
      foreignColumns: [table.id, table.schoolId],
    }),
    check("finance_ledger_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("finance_ledger_sequence_positive_check", sql`${table.sequence} > 0`),
    check("finance_ledger_currency_check", currencyCheck(table.currency)),
    check(
      "finance_ledger_reversal_shape_check",
      sql`(${table.type} = 'reversal' and ${table.reversalOfEntryId} is not null) or (${table.type} <> 'reversal' and ${table.reversalOfEntryId} is null)`,
    ),
    check(
      "finance_ledger_direction_type_check",
      sql`(${table.type} in ('bill', 'manual_debit_adjustment', 'refund', 'debit_correction') and ${table.direction} = 'debit') or (${table.type} in ('payment', 'discount', 'waiver', 'write_off', 'credit_correction') and ${table.direction} = 'credit') or ${table.type} = 'reversal'`,
    ),
    index("finance_ledger_admission_effective_idx").on(
      table.schoolId,
      table.admissionId,
      table.effectiveAt,
      table.sequence,
    ),
    index("finance_ledger_session_effective_idx").on(
      table.schoolId,
      table.sessionId,
      table.effectiveAt,
      table.sequence,
    ),
  ],
);

/** One immutable debit document owned by an admission account. */
export const financeBillTable = pgTable(
  "finance_bill",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("financeBill")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    admissionId: text("admission_id").notNull(),
    sessionId: text("session_id").notNull(),
    billRunId: text("bill_run_id"),
    ledgerEntryId: text("ledger_entry_id").notNull(),
    status: financeBillStatusEnum("status").notNull().default("posting"),
    sourceKind: financeBillSourceKindEnum("source_kind").notNull(),
    billNumber: text("bill_number").notNull(),
    issueDate: date("issue_date").notNull(),
    periodKey: text("period_key"),
    currency: varchar("currency", { length: 3 }).notNull(),
    totalAmountMinor: bigint("total_amount_minor", { mode: "bigint" }).notNull(),
    lineCount: integer("line_count").notNull(),
    admissionNumberSnapshot: text("admission_number_snapshot").notNull(),
    admissionNameSnapshot: text("admission_name_snapshot").notNull(),
    sessionStartYearSnapshot: integer("session_start_year_snapshot").notNull(),
    sessionEndYearSnapshot: integer("session_end_year_snapshot").notNull(),
    enrollmentIdSnapshot: text("enrollment_id_snapshot"),
    classIdSnapshot: text("class_id_snapshot"),
    classSlugSnapshot: text("class_slug_snapshot"),
    classLabelSnapshot: text("class_label_snapshot"),
    sectionIdSnapshot: text("section_id_snapshot"),
    sectionSlugSnapshot: text("section_slug_snapshot"),
    sectionLabelSnapshot: text("section_label_snapshot"),
    rollNumberSnapshot: integer("roll_number_snapshot"),
    configHash: text("config_hash"),
    manualReason: text("manual_reason"),
    recordedBy: text("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (table) => [
    unique("finance_bill_id_school_unique").on(table.id, table.schoolId),
    unique("finance_bill_identity_currency_unique").on(
      table.id,
      table.schoolId,
      table.admissionId,
      table.sessionId,
      table.currency,
    ),
    unique("finance_bill_id_school_currency_unique").on(
      table.id,
      table.schoolId,
      table.currency,
    ),
    unique("finance_bill_allocation_identity_unique").on(
      table.id,
      table.schoolId,
      table.admissionId,
      table.currency,
    ),
    unique("finance_bill_school_number_unique").on(
      table.schoolId,
      table.billNumber,
    ),
    unique("finance_bill_ledger_entry_unique").on(table.ledgerEntryId),
    foreignKey({
      name: "finance_bill_admission_school_fk",
      columns: [table.admissionId, table.schoolId],
      foreignColumns: [admissionTable.id, admissionTable.schoolId],
    }),
    foreignKey({
      name: "finance_bill_session_school_fk",
      columns: [table.sessionId, table.schoolId],
      foreignColumns: [schoolSessionTable.id, schoolSessionTable.schoolId],
    }),
    foreignKey({
      name: "finance_bill_run_school_fk",
      columns: [table.billRunId, table.schoolId],
      foreignColumns: [financeBillRunTable.id, financeBillRunTable.schoolId],
    }),
    foreignKey({
      name: "finance_bill_ledger_identity_fk",
      columns: [
        table.ledgerEntryId,
        table.schoolId,
        table.admissionId,
        table.sessionId,
        table.currency,
      ],
      foreignColumns: [
        financeLedgerEntryTable.id,
        financeLedgerEntryTable.schoolId,
        financeLedgerEntryTable.admissionId,
        financeLedgerEntryTable.sessionId,
        financeLedgerEntryTable.currency,
      ],
    }),
    check("finance_bill_total_positive_check", sql`${table.totalAmountMinor} > 0`),
    check("finance_bill_line_count_positive_check", sql`${table.lineCount} > 0`),
    check("finance_bill_currency_check", currencyCheck(table.currency)),
    check(
      "finance_bill_source_shape_check",
      sql`(${table.sourceKind} = 'billing_run' and ${table.billRunId} is not null and ${table.manualReason} is null) or (${table.sourceKind} = 'manual' and ${table.billRunId} is null and nullif(btrim(${table.manualReason}), '') is not null)`,
    ),
    check(
      "finance_bill_finalization_shape_check",
      sql`(${table.status} = 'posting' and ${table.finalizedAt} is null) or (${table.status} = 'posted' and ${table.finalizedAt} is not null)`,
    ),
    index("finance_bill_admission_issue_idx").on(
      table.schoolId,
      table.admissionId,
      table.issueDate,
      table.id,
    ),
    index("finance_bill_run_idx").on(table.schoolId, table.billRunId),
  ],
);

export const financeBillLineTable = pgTable(
  "finance_bill_line",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("financeBillLine")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    billId: text("bill_id").notNull(),
    lineOrder: integer("line_order").notNull(),
    feeElementSlug: text("fee_element_slug").notNull(),
    feeElementName: text("fee_element_name").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    pricingSourceKind: financePricingSourceKindEnum("pricing_source_kind").notNull(),
    pricingSourceKey: text("pricing_source_key"),
    pricingRuleSnapshot: jsonb("pricing_rule_snapshot")
      .$type<JsonSnapshot>()
      .notNull(),
    manualReason: text("manual_reason"),
  },
  (table) => [
    unique("finance_bill_line_id_school_unique").on(table.id, table.schoolId),
    unique("finance_bill_line_bill_order_unique").on(
      table.billId,
      table.lineOrder,
    ),
    foreignKey({
      name: "finance_bill_line_bill_school_fk",
      columns: [table.billId, table.schoolId, table.currency],
      foreignColumns: [
        financeBillTable.id,
        financeBillTable.schoolId,
        financeBillTable.currency,
      ],
    }),
    unique("finance_bill_line_bill_identity_unique").on(
      table.id,
      table.schoolId,
      table.billId,
      table.currency,
    ),
    check("finance_bill_line_amount_nonnegative_check", sql`${table.amountMinor} >= 0`),
    check("finance_bill_line_order_nonnegative_check", sql`${table.lineOrder} >= 0`),
    check("finance_bill_line_currency_check", currencyCheck(table.currency)),
    check(
      "finance_bill_line_manual_reason_check",
      sql`${table.pricingSourceKind} <> 'manual' or nullif(btrim(${table.manualReason}), '') is not null`,
    ),
    index("finance_bill_line_bill_idx").on(table.schoolId, table.billId),
  ],
);

export const financePaymentTable = pgTable(
  "finance_payment",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("financePayment")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    admissionId: text("admission_id").notNull(),
    sessionId: text("session_id").notNull(),
    ledgerEntryId: text("ledger_entry_id").notNull(),
    receiptNumber: text("receipt_number").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    method: financePaymentMethodEnum("method").notNull(),
    externalReference: text("external_reference"),
    payerName: text("payer_name"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    note: text("note"),
    idempotencyKey: text("idempotency_key").notNull(),
    recordedBy: text("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("finance_payment_id_school_unique").on(table.id, table.schoolId),
    unique("finance_payment_identity_currency_unique").on(
      table.id,
      table.schoolId,
      table.admissionId,
      table.sessionId,
      table.currency,
    ),
    unique("finance_payment_allocation_identity_unique").on(
      table.id,
      table.schoolId,
      table.admissionId,
      table.currency,
    ),
    unique("finance_payment_school_receipt_unique").on(
      table.schoolId,
      table.receiptNumber,
    ),
    unique("finance_payment_ledger_unique").on(table.ledgerEntryId),
    unique("finance_payment_school_idempotency_unique").on(
      table.schoolId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "finance_payment_admission_school_fk",
      columns: [table.admissionId, table.schoolId],
      foreignColumns: [admissionTable.id, admissionTable.schoolId],
    }),
    foreignKey({
      name: "finance_payment_session_school_fk",
      columns: [table.sessionId, table.schoolId],
      foreignColumns: [schoolSessionTable.id, schoolSessionTable.schoolId],
    }),
    foreignKey({
      name: "finance_payment_ledger_identity_fk",
      columns: [
        table.ledgerEntryId,
        table.schoolId,
        table.admissionId,
        table.sessionId,
        table.currency,
      ],
      foreignColumns: [
        financeLedgerEntryTable.id,
        financeLedgerEntryTable.schoolId,
        financeLedgerEntryTable.admissionId,
        financeLedgerEntryTable.sessionId,
        financeLedgerEntryTable.currency,
      ],
    }),
    check("finance_payment_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("finance_payment_currency_check", currencyCheck(table.currency)),
    index("finance_payment_admission_received_idx").on(
      table.schoolId,
      table.admissionId,
      table.receivedAt,
      table.id,
    ),
    index("finance_payment_reference_idx").on(
      table.schoolId,
      table.externalReference,
    ),
  ],
);

export const financePaymentAllocationTable = pgTable(
  "finance_payment_allocation",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("financePaymentAllocation")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    admissionId: text("admission_id").notNull(),
    paymentId: text("payment_id").notNull(),
    billId: text("bill_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("finance_allocation_payment_bill_unique").on(
      table.paymentId,
      table.billId,
    ),
    foreignKey({
      name: "finance_allocation_payment_identity_fk",
      columns: [
        table.paymentId,
        table.schoolId,
        table.admissionId,
        table.currency,
      ],
      foreignColumns: [
        financePaymentTable.id,
        financePaymentTable.schoolId,
        financePaymentTable.admissionId,
        financePaymentTable.currency,
      ],
    }),
    foreignKey({
      name: "finance_allocation_bill_identity_fk",
      columns: [
        table.billId,
        table.schoolId,
        table.admissionId,
        table.currency,
      ],
      foreignColumns: [
        financeBillTable.id,
        financeBillTable.schoolId,
        financeBillTable.admissionId,
        financeBillTable.currency,
      ],
    }),
    check("finance_allocation_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("finance_allocation_currency_check", currencyCheck(table.currency)),
    index("finance_allocation_bill_idx").on(table.schoolId, table.billId),
  ],
);

export const financeAdjustmentTable = pgTable(
  "finance_adjustment",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("financeAdjustment")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    admissionId: text("admission_id").notNull(),
    sessionId: text("session_id").notNull(),
    ledgerEntryId: text("ledger_entry_id").notNull(),
    billId: text("bill_id"),
    billLineId: text("bill_line_id"),
    kind: financeAdjustmentKindEnum("kind").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    reasonCode: text("reason_code").notNull(),
    reasonNote: text("reason_note").notNull(),
    calculationSnapshot: jsonb("calculation_snapshot")
      .$type<JsonSnapshot>()
      .notNull(),
    approvedBy: text("approved_by"),
    idempotencyKey: text("idempotency_key").notNull(),
    recordedBy: text("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("finance_adjustment_id_school_unique").on(table.id, table.schoolId),
    unique("finance_adjustment_ledger_unique").on(table.ledgerEntryId),
    unique("finance_adjustment_school_idempotency_unique").on(
      table.schoolId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "finance_adjustment_admission_school_fk",
      columns: [table.admissionId, table.schoolId],
      foreignColumns: [admissionTable.id, admissionTable.schoolId],
    }),
    foreignKey({
      name: "finance_adjustment_session_school_fk",
      columns: [table.sessionId, table.schoolId],
      foreignColumns: [schoolSessionTable.id, schoolSessionTable.schoolId],
    }),
    foreignKey({
      name: "finance_adjustment_ledger_identity_fk",
      columns: [
        table.ledgerEntryId,
        table.schoolId,
        table.admissionId,
        table.sessionId,
        table.currency,
      ],
      foreignColumns: [
        financeLedgerEntryTable.id,
        financeLedgerEntryTable.schoolId,
        financeLedgerEntryTable.admissionId,
        financeLedgerEntryTable.sessionId,
        financeLedgerEntryTable.currency,
      ],
    }),
    foreignKey({
      name: "finance_adjustment_bill_identity_fk",
      columns: [
        table.billId,
        table.schoolId,
        table.admissionId,
        table.sessionId,
        table.currency,
      ],
      foreignColumns: [
        financeBillTable.id,
        financeBillTable.schoolId,
        financeBillTable.admissionId,
        financeBillTable.sessionId,
        financeBillTable.currency,
      ],
    }),
    foreignKey({
      name: "finance_adjustment_line_school_fk",
      columns: [table.billLineId, table.schoolId, table.billId, table.currency],
      foreignColumns: [
        financeBillLineTable.id,
        financeBillLineTable.schoolId,
        financeBillLineTable.billId,
        financeBillLineTable.currency,
      ],
    }),
    check("finance_adjustment_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("finance_adjustment_currency_check", currencyCheck(table.currency)),
    check(
      "finance_adjustment_reason_check",
      sql`nullif(btrim(${table.reasonCode}), '') is not null and nullif(btrim(${table.reasonNote}), '') is not null`,
    ),
    check(
      "finance_adjustment_line_requires_bill_check",
      sql`${table.billLineId} is null or ${table.billId} is not null`,
    ),
    index("finance_adjustment_bill_idx").on(table.schoolId, table.billId),
  ],
);

export const financeRefundTable = pgTable(
  "finance_refund",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("financeRefund")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    admissionId: text("admission_id").notNull(),
    sessionId: text("session_id").notNull(),
    paymentId: text("payment_id").notNull(),
    ledgerEntryId: text("ledger_entry_id").notNull(),
    refundNumber: text("refund_number").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    method: financePaymentMethodEnum("method").notNull(),
    externalReference: text("external_reference"),
    reason: text("reason").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    recordedBy: text("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("finance_refund_id_school_unique").on(table.id, table.schoolId),
    unique("finance_refund_school_number_unique").on(
      table.schoolId,
      table.refundNumber,
    ),
    unique("finance_refund_ledger_unique").on(table.ledgerEntryId),
    unique("finance_refund_school_idempotency_unique").on(
      table.schoolId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "finance_refund_admission_school_fk",
      columns: [table.admissionId, table.schoolId],
      foreignColumns: [admissionTable.id, admissionTable.schoolId],
    }),
    foreignKey({
      name: "finance_refund_session_school_fk",
      columns: [table.sessionId, table.schoolId],
      foreignColumns: [schoolSessionTable.id, schoolSessionTable.schoolId],
    }),
    foreignKey({
      name: "finance_refund_payment_identity_fk",
      columns: [
        table.paymentId,
        table.schoolId,
        table.admissionId,
        table.sessionId,
        table.currency,
      ],
      foreignColumns: [
        financePaymentTable.id,
        financePaymentTable.schoolId,
        financePaymentTable.admissionId,
        financePaymentTable.sessionId,
        financePaymentTable.currency,
      ],
    }),
    foreignKey({
      name: "finance_refund_ledger_identity_fk",
      columns: [
        table.ledgerEntryId,
        table.schoolId,
        table.admissionId,
        table.sessionId,
        table.currency,
      ],
      foreignColumns: [
        financeLedgerEntryTable.id,
        financeLedgerEntryTable.schoolId,
        financeLedgerEntryTable.admissionId,
        financeLedgerEntryTable.sessionId,
        financeLedgerEntryTable.currency,
      ],
    }),
    check("finance_refund_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("finance_refund_currency_check", currencyCheck(table.currency)),
    check(
      "finance_refund_reason_check",
      sql`nullif(btrim(${table.reason}), '') is not null`,
    ),
    index("finance_refund_payment_idx").on(table.schoolId, table.paymentId),
  ],
);

export const financeNumberCounterTable = pgTable(
  "finance_number_counter",
  {
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    sessionId: text("session_id").notNull(),
    kind: financeNumberKindEnum("kind").notNull(),
    fiscalKey: text("fiscal_key").notNull(),
    nextValue: bigint("next_value", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.schoolId, table.sessionId, table.kind] }),
    foreignKey({
      name: "finance_number_counter_session_school_fk",
      columns: [table.sessionId, table.schoolId],
      foreignColumns: [schoolSessionTable.id, schoolSessionTable.schoolId],
    }),
    check("finance_number_counter_positive_check", sql`${table.nextValue} > 0`),
    check(
      "finance_number_counter_fiscal_key_check",
      sql`nullif(btrim(${table.fiscalKey}), '') is not null`,
    ),
  ],
);

/** Rebuildable cache; immutable ledger entries remain the source of truth. */
export const financeAdmissionBalanceTable = pgTable(
  "finance_admission_balance",
  {
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    admissionId: text("admission_id").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    lastSequence: bigint("last_sequence", { mode: "bigint" }).notNull(),
    debitTotalMinor: numeric("debit_total_minor", {
      precision: 38,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    creditTotalMinor: numeric("credit_total_minor", {
      precision: 38,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    rebuiltAt: timestamp("rebuilt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.schoolId, table.admissionId, table.currency] }),
    foreignKey({
      name: "finance_balance_admission_school_fk",
      columns: [table.admissionId, table.schoolId],
      foreignColumns: [admissionTable.id, admissionTable.schoolId],
    }),
    check("finance_balance_currency_check", currencyCheck(table.currency)),
    check(
      "finance_balance_totals_nonnegative_check",
      sql`${table.lastSequence} >= 0 and ${table.debitTotalMinor} >= 0 and ${table.creditTotalMinor} >= 0`,
    ),
  ],
);

/** Rebuildable cache attributed by the session stored on each ledger entry. */
export const financeAdmissionSessionActivityTable = pgTable(
  "finance_admission_session_activity",
  {
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    admissionId: text("admission_id").notNull(),
    sessionId: text("session_id").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    lastSequence: bigint("last_sequence", { mode: "bigint" }).notNull(),
    entryCount: bigint("entry_count", { mode: "bigint" }).notNull(),
    debitTotalMinor: numeric("debit_total_minor", {
      precision: 38,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    creditTotalMinor: numeric("credit_total_minor", {
      precision: 38,
      scale: 0,
      mode: "bigint",
    }).notNull(),
    rebuiltAt: timestamp("rebuilt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.schoolId,
        table.admissionId,
        table.sessionId,
        table.currency,
      ],
    }),
    foreignKey({
      name: "finance_activity_admission_school_fk",
      columns: [table.admissionId, table.schoolId],
      foreignColumns: [admissionTable.id, admissionTable.schoolId],
    }),
    foreignKey({
      name: "finance_activity_session_school_fk",
      columns: [table.sessionId, table.schoolId],
      foreignColumns: [schoolSessionTable.id, schoolSessionTable.schoolId],
    }),
    check("finance_activity_currency_check", currencyCheck(table.currency)),
    check(
      "finance_activity_totals_nonnegative_check",
      sql`${table.lastSequence} >= 0 and ${table.entryCount} >= 0 and ${table.debitTotalMinor} >= 0 and ${table.creditTotalMinor} >= 0`,
    ),
    index("finance_activity_session_idx").on(
      table.schoolId,
      table.sessionId,
      table.currency,
    ),
  ],
);

export const financeBillRunRelations = relations(
  financeBillRunTable,
  ({ one, many }) => ({
    school: one(schoolTable, {
      fields: [financeBillRunTable.schoolId],
      references: [schoolTable.id],
    }),
    session: one(schoolSessionTable, {
      fields: [financeBillRunTable.sessionId],
      references: [schoolSessionTable.id],
    }),
    bills: many(financeBillTable),
  }),
);

export const financeLedgerEntryRelations = relations(
  financeLedgerEntryTable,
  ({ one }) => ({
    admission: one(admissionTable, {
      fields: [financeLedgerEntryTable.admissionId],
      references: [admissionTable.id],
    }),
    session: one(schoolSessionTable, {
      fields: [financeLedgerEntryTable.sessionId],
      references: [schoolSessionTable.id],
    }),
    reversalOf: one(financeLedgerEntryTable, {
      fields: [financeLedgerEntryTable.reversalOfEntryId],
      references: [financeLedgerEntryTable.id],
      relationName: "financeLedgerReversal",
    }),
  }),
);

export const financeBillRelations = relations(
  financeBillTable,
  ({ one, many }) => ({
    run: one(financeBillRunTable, {
      fields: [financeBillTable.billRunId],
      references: [financeBillRunTable.id],
    }),
    ledgerEntry: one(financeLedgerEntryTable, {
      fields: [financeBillTable.ledgerEntryId],
      references: [financeLedgerEntryTable.id],
    }),
    lines: many(financeBillLineTable),
    allocations: many(financePaymentAllocationTable),
  }),
);

export const financeBillLineRelations = relations(
  financeBillLineTable,
  ({ one }) => ({
    bill: one(financeBillTable, {
      fields: [financeBillLineTable.billId],
      references: [financeBillTable.id],
    }),
  }),
);

export const financePaymentRelations = relations(
  financePaymentTable,
  ({ one, many }) => ({
    ledgerEntry: one(financeLedgerEntryTable, {
      fields: [financePaymentTable.ledgerEntryId],
      references: [financeLedgerEntryTable.id],
    }),
    allocations: many(financePaymentAllocationTable),
    refunds: many(financeRefundTable),
  }),
);

export const financePaymentAllocationRelations = relations(
  financePaymentAllocationTable,
  ({ one }) => ({
    payment: one(financePaymentTable, {
      fields: [financePaymentAllocationTable.paymentId],
      references: [financePaymentTable.id],
    }),
    bill: one(financeBillTable, {
      fields: [financePaymentAllocationTable.billId],
      references: [financeBillTable.id],
    }),
  }),
);

export const financeAdjustmentRelations = relations(
  financeAdjustmentTable,
  ({ one }) => ({
    ledgerEntry: one(financeLedgerEntryTable, {
      fields: [financeAdjustmentTable.ledgerEntryId],
      references: [financeLedgerEntryTable.id],
    }),
    bill: one(financeBillTable, {
      fields: [financeAdjustmentTable.billId],
      references: [financeBillTable.id],
    }),
    billLine: one(financeBillLineTable, {
      fields: [financeAdjustmentTable.billLineId],
      references: [financeBillLineTable.id],
    }),
  }),
);

export const financeRefundRelations = relations(
  financeRefundTable,
  ({ one }) => ({
    payment: one(financePaymentTable, {
      fields: [financeRefundTable.paymentId],
      references: [financePaymentTable.id],
    }),
    ledgerEntry: one(financeLedgerEntryTable, {
      fields: [financeRefundTable.ledgerEntryId],
      references: [financeLedgerEntryTable.id],
    }),
  }),
);

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  date,
  jsonb,
  pgTable,
  unique,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import { generateId } from "../id";
import { classTable } from "./class";
import {
  admissionDocumentsSchema,
  studentFinanceValuesSchema,
} from "./jsonb";
import type {
  AdmissionDocument,
  StudentFinanceValuesMap,
} from "./jsonb";
import { schoolTable } from "./school";

export const admissionTable = pgTable("admission", {
  id: text("id")
    .primaryKey()
    .$default(() => generateId("admission")),
  schoolId: text("school_id")
    .notNull()
    .references(() => schoolTable.id),
  name: varchar("name").notNull(),
  admissionNo: varchar("admission_no").notNull(),
  admissionClassId: text("admission_class_id").references(() => classTable.id),
  address: varchar("address").notNull(),
  /**
   * The household phone number. New and edited values are E.164 (validated
   * with `@campuspilot/db/phone`). Values entered before validation existed
   * are converted by the `admission-phone-e164` data migration; one it could
   * not parse keeps its text with a `+91` prefix (D-32), so readers must
   * tolerate a non-E.164 value.
   */
  phoneNo: varchar("phone_no").notNull(),
  /**
   * The WhatsApp number in E.164, its own fact (D-4). Null when there is
   * none. While `whatsappSameAsPhone` is true it equals `phoneNo` (CHECK),
   * and the API keeps it equal when the phone number changes.
   */
  whatsappNo: varchar("whatsapp_no"),
  /**
   * Whether the WhatsApp number is the phone number, as chosen by staff
   * (D-4). Null means no choice was ever recorded: the admission predates the
   * WhatsApp fields and the phone backfill has not reached it yet. Every
   * create and the backfill set it explicitly.
   */
  whatsappSameAsPhone: boolean("whatsapp_same_as_phone"),
  /** Staff confirmed the WhatsApp number with the guardian (D-4). Never derived. */
  whatsappVerified: boolean("whatsapp_verified").notNull().default(false),
  /**
   * The guardian consented to WhatsApp notifications (D-8). Unticking it is
   * the opt-out. WhatsApp is sent only with a number, verified and consent.
   */
  whatsappConsent: boolean("whatsapp_consent").notNull().default(false),
  email: varchar("email"),
  dob: date("dob").notNull(),
  fatherName: varchar("father_name").notNull(),
  motherName: varchar("mother_name").notNull(),
  /**
   * Whether this admission is still associated with the school. Every
   * admission- or student-level mutation must require this value to be true,
   * except the one-way unregister transition itself. A false value is final;
   * returning to the school requires a new admission record.
   */
  registered: boolean("registered").notNull().default(true),
  /**
   * Exact lifecycle fact for new unregister operations. Legacy unregistered
   * rows may remain null because their historical transition time is unknown.
   */
  unregisteredAt: timestamp("unregistered_at", { withTimezone: true }),
  photoS3Key: varchar("photo_s3_key"),
  documents: jsonb("documents")
    .$type<AdmissionDocument[]>()
    .notNull()
    .default(admissionDocumentsSchema.parse([])),
  /**
   * Admission-level finance values are partitioned by session ID because the
   * admission outlives any one academic session.
   */
  financeValue: jsonb("finance_config")
    .$type<StudentFinanceValuesMap>()
    .notNull()
    .default(studentFinanceValuesSchema.parse({})),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  unique("admission_id_school_id_unique").on(table.id, table.schoolId),
  check(
    "admission_whatsapp_same_as_phone_check",
    sql`${table.whatsappSameAsPhone} is not true or ${table.whatsappNo} = ${table.phoneNo}`,
  ),
  unique("admission_school_id_admission_no_unique").on(
    table.schoolId,
    table.admissionNo,
  ),
  index("admission_school_id_registered_idx").on(
    table.schoolId,
    table.registered,
  ),
  index("admission_number_trgm_idx").using(
    "gin",
    sql`${table.admissionNo} gin_trgm_ops`,
  ),
  index("admission_name_trgm_idx").using(
    "gin",
    sql`${table.name} gin_trgm_ops`,
  ),
]);

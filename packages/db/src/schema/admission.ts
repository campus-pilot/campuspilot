import {
  boolean,
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
  phoneNo: varchar("phone_no").notNull(),
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
  unique("admission_school_id_admission_no_unique").on(
    table.schoolId,
    table.admissionNo,
  ),
  index("admission_school_id_registered_idx").on(
    table.schoolId,
    table.registered,
  ),
]);

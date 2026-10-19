import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { generateId } from "../id";
import { admissionTable } from "./admission";
import { classTable, sectionTable } from "./class";
import { schoolTable } from "./school";
import { schoolSessionTable } from "./session";

/**
 * A student is an admission enrolled in an explicit academic session. Any
 * mutation of this row must first verify that its admission remains
 * registered with the school.
 */
export const studentTable = pgTable(
  "student",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("student")),
    classId: text("class_id").references(() => classTable.id),
    sectionId: text("section_id").references(() => sectionTable.id),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    admissionId: text("admission_id")
      .notNull()
      .references(() => admissionTable.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => schoolSessionTable.id),
    rollNo: integer("roll_no"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    unique("student_unique_session").on(
      table.admissionId,
      table.sessionId,
    ),
    unique("student_unique_rollno_per_section").on(
      table.sessionId,
      table.classId,
      table.sectionId,
      table.rollNo,
    ),
    index("student_school_session_admission_id_idx").on(
      table.schoolId,
      table.sessionId,
      table.admissionId,
      table.id,
    ),
    index("student_school_session_class_admission_id_idx").on(
      table.schoolId,
      table.sessionId,
      table.classId,
      table.admissionId,
      table.id,
    ),
  ],
);

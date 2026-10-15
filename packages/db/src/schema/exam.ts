import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { generateId } from "../id";
import type {
  ModeConfig,
  ResultMarks,
  CoScholasticGrades,
  TimetableConfig,
} from "./jsonb/exam-config";
import { schoolTable } from "./school";
import { schoolSessionTable } from "./session";
import { classTable } from "./class";
import { studentTable } from "./student";

export const examPlanStatusEnum = pgEnum("exam_plan_status", [
  "draft",
  "approved",
  "active",
  "completed",
]);
export const examPlanTable = pgTable(
  "exam_plan",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("examPlan")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => schoolSessionTable.id),
    examSlug: text("exam_slug").notNull(),
    classId: text("class_id")
      .notNull()
      .references(() => classTable.id),
    subjectSlug: text("subject_slug").notNull(),
    totalMarks: integer("total_marks").notNull(),
    modeConfig: jsonb("mode_config").$type<ModeConfig>().notNull(),
    totalWorkingDays: integer("total_working_days"),
    status: examPlanStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    unique("exam_plan_unique").on(
      table.sessionId,
      table.examSlug,
      table.classId,
      table.subjectSlug,
    ),
  ],
);
export const examResultTable = pgTable(
  "exam_result",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("examResult")),
    examPlanId: text("exam_plan_id")
      .notNull()
      .references(() => examPlanTable.id, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => studentTable.id),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => schoolSessionTable.id),
    marks: jsonb("marks").$type<ResultMarks>().notNull(),
    coScholastics: jsonb("co_scholastics").$type<CoScholasticGrades>(),
    daysAttended: integer("days_attended"),
    approved: boolean("approved").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    unique("exam_result_unique").on(table.examPlanId, table.studentId),
  ],
);
export const examTimetableTable = pgTable(
  "exam_timetable",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("examTimetable")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => schoolSessionTable.id),
    examSlug: text("exam_slug").notNull(),
    config: jsonb("config").$type<TimetableConfig>().notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    unique("exam_timetable_unique").on(table.sessionId, table.examSlug),
  ],
);

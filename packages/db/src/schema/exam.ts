import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  primaryKey,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { generateId } from '../id';
import type {
  ModeConfig,
  ResultMarks,
  CoScholasticGrades,
  TimetableConfig,
} from './jsonb/exam-config';
import { schoolTable } from './school';
import { schoolSessionTable } from './session';
import { classTable } from './class';
import { studentTable } from './student';

export const examPlanStatusEnum = pgEnum('exam_plan_status', [
  'draft',
  'approved',
  'active',
  'completed',
]);
export const examPlanTable = pgTable(
  'exam_plan',
  {
    id: text('id')
      .primaryKey()
      .$default(() => generateId('examPlan')),
    schoolId: text('school_id')
      .notNull()
      .references(() => schoolTable.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => schoolSessionTable.id),
    examSlug: text('exam_slug').notNull(),
    classId: text('class_id')
      .notNull()
      .references(() => classTable.id),
    subjectSlug: text('subject_slug').notNull(),
    totalMarks: integer('total_marks').notNull(),
    modeConfig: jsonb('mode_config').$type<ModeConfig>().notNull(),
    totalWorkingDays: integer('total_working_days'),
    status: examPlanStatusEnum('status').notNull().default('draft'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    unique('exam_plan_unique').on(
      table.sessionId,
      table.examSlug,
      table.classId,
      table.subjectSlug,
    ),
  ],
);
export const examResultTable = pgTable(
  'exam_result',
  {
    id: text('id')
      .primaryKey()
      .$default(() => generateId('examResult')),
    examPlanId: text('exam_plan_id')
      .notNull()
      .references(() => examPlanTable.id, { onDelete: 'cascade' }),
    studentId: text('student_id')
      .notNull()
      .references(() => studentTable.id),
    schoolId: text('school_id')
      .notNull()
      .references(() => schoolTable.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => schoolSessionTable.id),
    marks: jsonb('marks').$type<ResultMarks>().notNull(),
    coScholastics: jsonb('co_scholastics').$type<CoScholasticGrades>(),
    daysAttended: integer('days_attended'),
    approved: boolean('approved').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    unique('exam_result_unique').on(table.examPlanId, table.studentId),
  ],
);
export const examTimetableTable = pgTable(
  'exam_timetable',
  {
    id: text('id')
      .primaryKey()
      .$default(() => generateId('examTimetable')),
    schoolId: text('school_id')
      .notNull()
      .references(() => schoolTable.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => schoolSessionTable.id),
    examSlug: text('exam_slug').notNull(),
    config: jsonb('config').$type<TimetableConfig>().notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    unique('exam_timetable_unique').on(table.sessionId, table.examSlug),
  ],
);

/** Exam-wide attendance settings are independent from subject marks configuration. */
export const examAssessmentSettingsTable = pgTable(
  'exam_assessment_settings',
  {
    schoolId: text('school_id')
      .notNull()
      .references(() => schoolTable.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => schoolSessionTable.id),
    examSlug: text('exam_slug').notNull(),
    totalWorkingDays: integer('total_working_days'),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.examSlug] })],
);

/** Attendance and activities belong to the student's whole exam, never a subject.
 * Legacy per-subject values remain preserved separately; they are not inferred
 * to be an exam-wide fact or copied automatically during migration.
 */
export const examStudentAssessmentTable = pgTable(
  'exam_student_assessment',
  {
    schoolId: text('school_id')
      .notNull()
      .references(() => schoolTable.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => schoolSessionTable.id),
    examSlug: text('exam_slug').notNull(),
    studentId: text('student_id')
      .notNull()
      .references(() => studentTable.id),
    daysAttended: integer('days_attended'),
    coScholastics: jsonb('co_scholastics').$type<CoScholasticGrades>(),
    approved: boolean('approved').notNull().default(false),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.examSlug, table.studentId] }),
  ],
);

/** Starting/ending the examination is an explicit school-governed fact,
 * independent of whether a plan or a timetable has been generated.
 * Timestamps stay null when historical transition times are unknown.
 */
export const examLifecycleStatusEnum = pgEnum('exam_lifecycle_status', [
  'ready',
  'active',
  'completed',
]);
export const examLifecycleTable = pgTable(
  'exam_lifecycle',
  {
    schoolId: text('school_id')
      .notNull()
      .references(() => schoolTable.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => schoolSessionTable.id),
    examSlug: text('exam_slug').notNull(),
    status: examLifecycleStatusEnum('status').notNull().default('ready'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.examSlug] })],
);

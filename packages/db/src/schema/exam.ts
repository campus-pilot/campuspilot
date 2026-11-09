import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
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
import { user } from './auth';

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
 * Legacy migration may promote repeated per-subject values only through its
 * explicitly approved agreement-and-conflict rule; ordinary runtime code must
 * not infer this row from a subject result.
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
    /**
     * When the school explicitly released this examination's results to the
     * Cadet Portal; null while they are not visible there. This is its own
     * fact and is never derived from `status`: a completed examination stays
     * hidden from students until someone releases it, and withdrawing clears
     * it again. Release currently requires `status = 'completed'` and blocks
     * reopening, but that is enforced by the procedures, not inferred here.
     *
     * Unlike its older siblings `started_at` / `completed_at` (plain
     * `timestamp`, kept as they are to avoid rewriting legacy rows), this is
     * `timestamptz`: it is shown to students and guardians as a calendar date,
     * so it must be an unambiguous instant whatever the server's time zone.
     */
    cadetReleasedAt: timestamp('cadet_released_at', { withTimezone: true }),
    /** The staff user who performed the current release; null when not released or the account was deleted. */
    cadetReleasedBy: text('cadet_released_by').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.examSlug] })],
);

/** Maximum length of a teacher's remark on one student's examination. */
export const EXAM_STUDENT_REMARK_MAX_LENGTH = 1000;

/**
 * A teacher's written remark on one student's whole examination (not a
 * subject). Students see it in the Cadet Portal only once the examination is
 * released there. `authorId` is whoever saved the current text; `createdAt`
 * is when the remark was first written and `updatedAt` when its text last
 * changed. Removing a remark deletes the row.
 */
export const examStudentRemarkTable = pgTable(
  'exam_student_remark',
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
    text: text('text').notNull(),
    authorId: text('author_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.examSlug, table.studentId] }),
    index('exam_student_remark_school_student_idx').on(
      table.schoolId,
      table.studentId,
    ),
    check(
      'exam_student_remark_text_length_check',
      sql`char_length(${table.text}) between 1 and ${sql.raw(String(EXAM_STUDENT_REMARK_MAX_LENGTH))}`,
    ),
  ],
);

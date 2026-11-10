import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { generateId } from "../id";
import { artifactTable } from "./artifact";
import { user } from "./auth";
import { classTable } from "./class";
import { schoolTable } from "./school";
import { schoolSessionTable } from "./session";

/**
 * How a notice's `body` is interpreted:
 * - `plain`: plain text placed into the school's Notice document template
 *   (or the built-in default design when the school selected none);
 * - `template`: the author's own Handlebars source, which is the whole
 *   document.
 * Both go through the same restricted renderer, sanitizer and school-only
 * context (docs/document-system.md).
 */
export const noticeBodyModeEnum = pgEnum("notice_body_mode", ["plain", "template"]);

/** One-way lifecycle: a published notice is immutable. */
export const noticeStatusEnum = pgEnum("notice_status", ["draft", "published"]);

/**
 * Which students a notice is addressed to, independent of `to_staff`:
 * - `none`: no students;
 * - `all_classes`: every student enrolled in the notice's session;
 * - `selected_classes`: students whose class in the notice's session is one
 *   of the notice's `notice_class` rows.
 */
export const noticeCadetScopeEnum = pgEnum("notice_cadet_scope", [
  "none",
  "all_classes",
  "selected_classes",
]);

/**
 * A school notice of one academic session. The audience is two explicit
 * facts, `to_staff` and `cadet_scope`; at least one of them addresses
 * someone. A draft can be edited and deleted; publishing is one-way and
 * freezes every column.
 */
export const noticeTable = pgTable(
  "notice",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("notice")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => schoolSessionTable.id),
    title: text("title").notNull(),
    bodyMode: noticeBodyModeEnum("body_mode").notNull(),
    /** Plain text or Handlebars source, according to `body_mode`. */
    body: text("body").notNull(),
    status: noticeStatusEnum("status").notNull().default("draft"),
    /** Addressed to the school's staff (every member of the school). */
    toStaff: boolean("to_staff").notNull(),
    cadetScope: noticeCadetScopeEnum("cadet_scope").notNull(),
    /** The author; null after the account is deleted. */
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Counts the writes to this notice: 1 when created, plus one for every
     * saved edit and for the publication. It is the optimistic-concurrency
     * token: `updateNotice` and `publishNotice` name the version the caller
     * read and are refused with CONFLICT when the row has moved on, so
     * nobody overwrites, or irreversibly publishes, content they did not
     * see. It is its own fact, not `updated_at`: a timestamp loses precision
     * between PostgreSQL and JavaScript and says nothing about intent.
     */
    version: integer("version").notNull().default(1),
    /** Who published it; null for a draft and after the account is deleted. */
    publishedBy: text("published_by").references(() => user.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /**
     * The calendar date printed on the notice ("issued on"), decided once at
     * publication from the publication instant and the time zone the session
     * stated then. Stored, never recomputed: a later change of the session's
     * time zone must not move the date of a notice that already went out.
     * Null for a draft (a draft preview shows today's date).
     */
    issuedOn: date("issued_on", { mode: "string" }),
    /**
     * The school's Notice template revision pinned when a `plain` notice was
     * published, so its rendered output never changes with a later template
     * edit. Null for a draft, for a `template` notice (its body is the
     * document) and for a `plain` notice published while the school had
     * selected no template (the built-in default design is used).
     */
    templateRevisionId: text("template_revision_id").references(
      () => artifactTable.id,
    ),
    /**
     * Recipients resolved when it was published: school members notified
     * (0 when not addressed to staff) and students notified (0 when not
     * addressed to students). Null for a draft.
     */
    publishedStaffCount: integer("published_staff_count"),
    publishedCadetCount: integer("published_cadet_count"),
  },
  (table) => [
    index("notice_school_session_created_idx").on(
      table.schoolId,
      table.sessionId,
      table.createdAt,
      table.id,
    ),
    index("notice_school_session_published_idx")
      .on(table.schoolId, table.sessionId, table.publishedAt, table.id)
      .where(sql`${table.status} = 'published'`),
    index("notice_created_by_idx").on(table.createdBy),
    index("notice_published_by_idx").on(table.publishedBy),
    check(
      "notice_audience_check",
      sql`${table.toStaff} or ${table.cadetScope} <> 'none'`,
    ),
    check(
      "notice_published_facts_check",
      sql`(${table.status} = 'published') = (${table.publishedAt} is not null)
        and (${table.status} = 'published') = (${table.issuedOn} is not null)
        and (${table.status} = 'published') = (${table.publishedStaffCount} is not null)
        and (${table.status} = 'published') = (${table.publishedCadetCount} is not null)
        and (${table.status} = 'published' or ${table.publishedBy} is null)`,
    ),
    check(
      "notice_template_revision_check",
      sql`${table.templateRevisionId} is null or (${table.status} = 'published' and ${table.bodyMode} = 'plain')`,
    ),
    check(
      "notice_title_check",
      sql`char_length(${table.title}) between 1 and 200`,
    ),
    check("notice_version_check", sql`${table.version} >= 1`),
  ],
);

/**
 * The classes a `selected_classes` notice is addressed to. Rows exist only
 * for that scope. `school_id` repeats the notice's school so every query is
 * tenant-scoped; the API verifies that each class belongs to it.
 *
 * A row is an audience record that outlives its class:
 * - `class_id` is the live reference used for targeting and visibility. It
 *   goes null when the class is deleted (`ON DELETE SET NULL`), so a notice
 *   never blocks deleting a class and a deleted class addresses nobody;
 * - `class_name` is the class's name as the audience was recorded: when a
 *   draft was last saved, and again at publication. It is what a published
 *   notice shows, so "sent to Class 5 and Class 8" stays true after Class 8
 *   is renamed or deleted.
 * Publishing drops a draft's rows whose class is already gone (that class
 * was never addressed), so every row of a published notice names a class
 * that existed when it was published.
 */
export const noticeClassTable = pgTable(
  "notice_class",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("noticeClass")),
    noticeId: text("notice_id")
      .notNull()
      .references(() => noticeTable.id, { onDelete: "cascade" }),
    /** Null once the class has been deleted; see the table comment. */
    classId: text("class_id").references(() => classTable.id, {
      onDelete: "set null",
    }),
    /** The class's name when the audience was recorded (save, then publication). */
    className: text("class_name").notNull(),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
  },
  (table) => [
    // One row per live class of a notice; rows of deleted classes (null) are not constrained.
    uniqueIndex("notice_class_notice_class_unique").on(table.noticeId, table.classId),
    index("notice_class_class_idx").on(table.classId),
    index("notice_class_school_idx").on(table.schoolId),
  ],
);

export type NoticeRow = typeof noticeTable.$inferSelect;
export type NoticeBodyMode = (typeof noticeBodyModeEnum.enumValues)[number];
export type NoticeStatus = (typeof noticeStatusEnum.enumValues)[number];
export type NoticeCadetScope = (typeof noticeCadetScopeEnum.enumValues)[number];

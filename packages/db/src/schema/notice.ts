import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
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
    /** Who published it; null for a draft and after the account is deleted. */
    publishedBy: text("published_by").references(() => user.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
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
  ],
);

/**
 * The classes a `selected_classes` notice is addressed to. Rows exist only
 * for that scope. `school_id` repeats the notice's school so every query is
 * tenant-scoped; the API verifies that each class belongs to it.
 */
export const noticeClassTable = pgTable(
  "notice_class",
  {
    noticeId: text("notice_id")
      .notNull()
      .references(() => noticeTable.id, { onDelete: "cascade" }),
    /**
     * Cascades: deleting a class must not be blocked by a notice that named
     * it. A draft left without any class cannot be published until one is
     * chosen again.
     */
    classId: text("class_id")
      .notNull()
      .references(() => classTable.id, { onDelete: "cascade" }),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
  },
  (table) => [
    primaryKey({ columns: [table.noticeId, table.classId] }),
    index("notice_class_class_idx").on(table.classId),
    index("notice_class_school_idx").on(table.schoolId),
  ],
);

export type NoticeRow = typeof noticeTable.$inferSelect;
export type NoticeBodyMode = (typeof noticeBodyModeEnum.enumValues)[number];
export type NoticeStatus = (typeof noticeStatusEnum.enumValues)[number];
export type NoticeCadetScope = (typeof noticeCadetScopeEnum.enumValues)[number];

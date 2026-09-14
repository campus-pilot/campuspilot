import { relations } from "drizzle-orm";
import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { schoolTable } from "./school";

/**
 * Models school membership independently from role assignments. In particular,
 * `addedAt` remains stable when the member's desired role set is replaced.
 */
export const schoolMemberTable = pgTable(
  "school_member",
  {
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.schoolId, table.userId] }),
    index("school_member_user_id_idx").on(table.userId),
  ],
);

export const schoolMemberRelations = relations(
  schoolMemberTable,
  ({ one }) => ({
    school: one(schoolTable, {
      fields: [schoolMemberTable.schoolId],
      references: [schoolTable.id],
    }),
    user: one(user, {
      fields: [schoolMemberTable.userId],
      references: [user.id],
    }),
  }),
);

import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { roles, type RoleMeta } from "./jsonb/role";
import { schoolTable } from "./school";

/**
 * Stores platform roles independently from Better Auth's system-level role.
 * One row represents one explicit role assignment so a user can hold multiple
 * roles in the same school without encoding role sets into a single column.
 */
export const schoolUserRoleTable = pgTable(
  "school_user_role",
  {
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: roles }).notNull(),
    meta: jsonb("meta").$type<RoleMeta>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.schoolId, table.userId, table.role] }),
    index("school_user_role_user_id_idx").on(table.userId),
  ],
);

export const schoolUserRoleRelations = relations(
  schoolUserRoleTable,
  ({ one }) => ({
    school: one(schoolTable, {
      fields: [schoolUserRoleTable.schoolId],
      references: [schoolTable.id],
    }),
    user: one(user, {
      fields: [schoolUserRoleTable.userId],
      references: [user.id],
    }),
  }),
);

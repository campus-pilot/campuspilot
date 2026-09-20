import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { generateId } from "../id";
import { financeClassOverridesSchema } from "./jsonb";
import type {
  FinanceClassOverrides,
  FinanceSchemaConfig,
  SessionConfig,
} from "./jsonb";
import { schoolTable } from "./school";

export const schoolSessionTable = pgTable(
  "school_session",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("schoolSession")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    sessionEndYear: integer("session_end_year").notNull(),
    sessionStartYear: integer("session_start_year").notNull(),
    sessionConfig: jsonb("session_config").$type<SessionConfig>(),
    financeConfig: jsonb("finance_config").$type<FinanceSchemaConfig>(),
    financeClassOverrides: jsonb("finance_class_overrides")
      .$type<FinanceClassOverrides>()
      .notNull()
      .default(financeClassOverridesSchema.parse({})),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("school_session_school_id_idx").on(table.schoolId),
    uniqueIndex("school_session_school_id_start_end_year_unique").on(
      table.schoolId,
      table.sessionStartYear,
      table.sessionEndYear,
    ),
    // Activation is modeled independently from the session dates. The partial
    // index enforces that a school can have at most one active session.
    uniqueIndex("school_session_one_active_per_school_idx")
      .on(table.schoolId)
      .where(sql`${table.isActive} = true`),
  ],
);

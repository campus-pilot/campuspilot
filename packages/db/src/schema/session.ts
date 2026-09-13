import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { generateId } from "../id";
import type { FinanceSchemaConfig, SessionConfig } from "./jsonb";
import { schoolTable } from "./school";

export const schoolSessionTable = pgTable("school_session", {
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
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

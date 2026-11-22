import {
  customType,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

import { generateId } from "../id";
import { attributesSchema, classConfigSchema, readStoredClassConfig } from "./jsonb";
import type { Attributes, ClassConfig } from "./jsonb";
import { schoolTable } from "./school";

/**
 * `class.config` is jsonb like any other JSON column, read through
 * {@link readStoredClassConfig}, so subjects written without an attachment
 * (before attachments existed, or by the previous release during a rolling
 * deploy) read as classroom subjects everywhere the column is selected.
 * Writes are serialised exactly as Drizzle's `jsonb` does.
 */
const classConfigJsonb = customType<{ data: ClassConfig; driverData: unknown }>({
  dataType: () => "jsonb",
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => readStoredClassConfig(typeof value === "string" ? JSON.parse(value) : value),
});

export const classTable = pgTable(
  "class",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("class")),
    slug: varchar("slug").notNull(),
    label: varchar("label").notNull(),
    displayOrder: integer("display_order").notNull(),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    attributes: jsonb("attributes")
      .$type<Attributes>()
      .notNull()
      .default(attributesSchema.parse({})),
    config: classConfigJsonb("config")
      .notNull()
      .default(classConfigSchema.parse({})),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    unique("class_slug_unique").on(table.schoolId, table.slug),
    unique("class_school_id_display_order_unique").on(
      table.schoolId,
      table.displayOrder,
    ),
  ],
);

export const sectionTable = pgTable(
  "section",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("section")),
    slug: varchar("slug").notNull(),
    label: varchar("label").notNull(),
    displayOrder: integer("display_order").notNull(),
    classId: text("class_id")
      .notNull()
      .references(() => classTable.id),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    attributes: jsonb("attributes")
      .$type<Attributes>()
      .notNull()
      .default(attributesSchema.parse({})),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    unique("section_slug_unique").on(table.classId, table.slug),
    unique("section_class_id_display_order_unique").on(
      table.classId,
      table.displayOrder,
    ),
  ],
);

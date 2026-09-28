import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

import { generateId } from "../id";
import { attributesSchema, classConfigSchema } from "./jsonb";
import type { Attributes, ClassConfig } from "./jsonb";
import { schoolTable } from "./school";

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
    config: jsonb("config")
      .$type<ClassConfig>()
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

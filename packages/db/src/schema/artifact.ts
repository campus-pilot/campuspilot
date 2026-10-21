import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type { DocumentGenerationOptions } from "./jsonb/document-config";
import { generateId } from "../id";
import { schoolTable } from "./school";

export const documentTypeEnum = pgEnum("document_type", [
  "report_card",
  "id_card",
  "admit_card",
  "timetable",
  "bill",
  "receipt",
  "statement",
]);
export const artifactKindEnum = pgEnum("artifact_kind", ["template", "pdf"]);
export const artifactStatusEnum = pgEnum("artifact_status", [
  "ready",
  "deleting",
]);
export const documentTemplatePageSizeEnum = pgEnum(
  "document_template_page_size",
  ["full", "half"],
);

/** Immutable object references outlive the source enrollment, class, and session.
 * Source IDs are historical identifiers, not cascading foreign keys. The school
 * remains the authorization boundary even after the source data is removed.
 */
export const artifactTable = pgTable(
  "artifact",
  {
    id: text("id")
      .primaryKey()
      .$default(() => generateId("artifact")),
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    kind: artifactKindEnum("kind").notNull(),
    documentType: documentTypeEnum("document_type").notNull(),
    status: artifactStatusEnum("status").notNull().default("ready"),
    name: text("name").notNull(),
    s3Key: text("s3_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    /** The footprint of one rendered document on its physical A4 sheet.
     * Historical artifacts default to full so a migration never changes how
     * an already-selected template is interpreted.
     */
    pageSize: documentTemplatePageSizeEnum("page_size")
      .notNull()
      .default("full"),
    templateRevisionId: text("template_revision_id"),
    marketplaceSlug: text("marketplace_slug"),
    sessionId: text("session_id"),
    examSlug: text("exam_slug"),
    classId: text("class_id"),
    studentIds: jsonb("student_ids").$type<string[]>().notNull().default([]),
    generationOptions: jsonb("generation_options")
      .$type<DocumentGenerationOptions>()
      .notNull()
      .default({}),
    studentCount: integer("student_count").notNull().default(0),
    /** Finance source IDs and the exact as-of sequence are historical
     * provenance, not foreign keys: posted facts and generated PDFs must
     * remain explainable after operational records are archived. */
    financeSource: jsonb("finance_source")
      .$type<
        | { kind: "bill"; admissionIds: string[]; billIds: string[]; billRunId: string | null }
        | { kind: "receipt"; admissionIds: string[]; transactions: Array<{ kind: "payment" | "refund"; id: string }> }
        | { kind: "statement"; currency: string; throughDate: string; timeZone: string; accounts: Array<{ admissionId: string; highWaterSequence: string }> }
        | null
      >(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("artifact_school_created_idx").on(t.schoolId, t.createdAt, t.id),
    index("artifact_template_revision_idx").on(t.templateRevisionId),
  ],
);

/** One explicit selection per school and document type. Updating a selection
 * creates a new immutable artifact; expectedRevisionId prevents lost edits.
 */
export const schoolDocumentTemplateTable = pgTable(
  "school_document_template",
  {
    schoolId: text("school_id")
      .notNull()
      .references(() => schoolTable.id),
    documentType: documentTypeEnum("document_type").notNull(),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifactTable.id),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("school_document_template_unique").on(t.schoolId, t.documentType),
  ],
);

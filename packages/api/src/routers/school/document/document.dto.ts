import { z } from "zod";
import {
  reportSectionsSchema,
  DEFAULT_REPORT_SECTIONS,
  reportResultPolicySchema,
  documentGenerationOptionsSchema,
} from "@campuspilot/db/schema/jsonb/document-config";
export { reportSectionsSchema, DEFAULT_REPORT_SECTIONS };

import {
  createListInputSchema,
  createPaginatedOutputSchema,
} from "../../../paginations";

export const documentTypeSchema = z.enum([
  "report_card",
  "id_card",
  "admit_card",
  "timetable",
]);
export type DocumentType = z.infer<typeof documentTypeSchema>;
export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  report_card: "Report cards",
  id_card: "Student ID cards",
  admit_card: "Admit cards",
  timetable: "Exam timetables",
};
const id = z.string().trim().min(1).max(100);
export const schoolScopeSchema = z.object({ schoolId: id });
export const templateScopeSchema = schoolScopeSchema.extend({
  documentType: documentTypeSchema,
});
export const templateContentSchema = z
  .string()
  .trim()
  .min(1, "Template content is required")
  .max(200_000);
export const artifactDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  kind: z.enum(["template", "pdf"]),
  documentType: documentTypeSchema,
  status: z.enum(["ready", "deleting"]),
  name: z.string(),
  contentType: z.string(),
  byteSize: z.number().int(),
  sha256: z.string(),
  templateRevisionId: z.string().nullable(),
  templateName: z.string().nullable(),
  marketplaceSlug: z.string().nullable(),
  sessionId: z.string().nullable(),
  examSlug: z.string().nullable(),
  classId: z.string().nullable(),
  studentIds: z.array(z.string()),
  studentCount: z.number().int(),
  generationOptions: documentGenerationOptionsSchema,
  createdBy: z.string(),
  createdAt: z.string(),
});
export type DocumentArtifact = z.infer<typeof artifactDtoSchema>;
export const activeTemplateSchema = z.object({
  artifact: artifactDtoSchema,
  content: z.string(),
});
export const saveTemplateSchema = templateScopeSchema.extend({
  name: z.string().trim().min(1).max(120),
  content: templateContentSchema,
  expectedRevisionId: id.nullable(),
});
export const selectTemplateSchema = templateScopeSchema.extend({
  slug: z.string().trim().min(1).max(100),
  expectedRevisionId: id.nullable(),
});
export const marketplaceItemSchema = z.object({
  slug: z.string(),
  documentType: documentTypeSchema,
  name: z.string(),
  description: z.string(),
});
export const listMarketplaceSchema = createListInputSchema({
  ...templateScopeSchema.shape,
  searchQuery: z.string().trim().max(100).default(""),
});
export const listMarketplaceOutputSchema = createPaginatedOutputSchema(
  marketplaceItemSchema,
);
export const previewTemplateSchema = templateScopeSchema.extend({
  content: templateContentSchema,
});
export const previewOutputSchema = z.object({
  html: z.string(),
  studentCount: z.number().int(),
  warnings: z.array(z.string()),
});

const selection = {
  sessionId: id,
  classId: id,
  studentIds: z.array(id).min(1).max(500).optional(),
};
/** IDs remain independent inputs. The server verifies their school, session,
 * class and enrollment relationships instead of trusting a UI selection.
 */
export const documentSourceSchema = z.discriminatedUnion("documentType", [
  z.object({ documentType: z.literal("id_card"), ...selection }),
  z.object({
    documentType: z.literal("report_card"),
    ...selection,
    classId: id.optional(),
    examSlug: id,
    resultPolicy: reportResultPolicySchema.default("require_all"),
    reportSections: reportSectionsSchema.default(DEFAULT_REPORT_SECTIONS),
  }),
  z.object({
    documentType: z.literal("admit_card"),
    sessionId: id,
    classId: id.optional(),
    studentIds: selection.studentIds,
    examSlug: id,
  }),
  z.object({
    documentType: z.literal("timetable"),
    sessionId: id,
    examSlug: id,
    classId: id.optional(),
  }),
]);
export type DocumentSource = z.infer<typeof documentSourceSchema>;
export const generateDocumentSchema = schoolScopeSchema.extend({
  source: documentSourceSchema,
  templateRevisionId: id,
});
export const listArtifactsSchema = createListInputSchema({
  ...schoolScopeSchema.shape,
  filters: z
    .object({
      documentType: documentTypeSchema.optional(),
      sessionId: id.optional(),
      classId: id.optional(),
      examSlug: id.optional(),
      studentId: id.optional(),
    })
    .default({}),
  searchQuery: z.string().trim().max(100).default(""),
  orderBy: z
    .object({
      field: z.enum(["createdAt", "name"]),
      direction: z.enum(["asc", "desc"]),
    })
    .default({ field: "createdAt", direction: "desc" }),
});
export const listArtifactsOutputSchema =
  createPaginatedOutputSchema(artifactDtoSchema);
export const artifactScopeSchema = schoolScopeSchema.extend({ artifactId: id });

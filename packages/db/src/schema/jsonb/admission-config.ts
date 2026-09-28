import { z } from "zod";

export const MAX_ADMISSION_DOCUMENT_TYPES = 10;
export const MAX_ADMISSION_FILES_PER_DOCUMENT = 10;
export const MAX_ADMISSION_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

export const admissionDocumentFileSchema = z.object({
  id: z.string().trim().min(1).max(100),
  s3Key: z.string().trim().min(1).max(1_024),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_ADMISSION_DOCUMENT_SIZE_BYTES),
  uploadedAt: z.iso.datetime(),
});

/**
 * A configured document type is a logical group, not an individual upload.
 * This permits documents such as identity cards to keep front and back files
 * under one configured type without duplicating the school setting.
 */
export const admissionDocumentSchema = z.object({
  value: z.string().trim().min(1).max(100),
  /** Present for admission-specific types that are not in school settings. */
  label: z.string().trim().min(1).max(200).optional(),
  files: z
    .array(admissionDocumentFileSchema)
    .min(1)
    .max(
      MAX_ADMISSION_FILES_PER_DOCUMENT,
      `Each document type can contain at most ${MAX_ADMISSION_FILES_PER_DOCUMENT} files.`,
    ),
});

export const admissionDocumentsSchema = z
  .array(admissionDocumentSchema)
  .max(
    MAX_ADMISSION_DOCUMENT_TYPES,
    `An admission can have at most ${MAX_ADMISSION_DOCUMENT_TYPES} document types.`,
  )
  .refine(
    (documents) =>
      new Set(documents.map(({ value }) => value)).size === documents.length,
    "Admission document group values must be unique.",
  );

export const admissionDocumentTypeSchema = z.object({
  value: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
});

export const admissionSettingsSchema = z
  .object({
    documentTypes: z
      .array(admissionDocumentTypeSchema)
      .max(MAX_ADMISSION_DOCUMENT_TYPES)
      .default([]),
  })
  .refine(
    ({ documentTypes }) =>
      new Set(documentTypes.map(({ value }) => value)).size ===
      documentTypes.length,
    {
      message: "Admission document type values must be unique.",
      path: ["documentTypes"],
    },
  );

export type AdmissionDocument = z.infer<typeof admissionDocumentSchema>;
export type AdmissionDocumentFile = z.infer<typeof admissionDocumentFileSchema>;
export type AdmissionSettings = z.infer<typeof admissionSettingsSchema>;

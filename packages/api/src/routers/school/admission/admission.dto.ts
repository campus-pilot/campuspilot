import { phoneNumberSchema } from "@campuspilot/db/phone";
import { admissionDocumentsSchema } from "@campuspilot/db/schema/jsonb/admission-config";
import { z } from "zod";

import {
  createListInputSchema,
  createPaginatedOutputSchema,
} from "../../../paginations";

const requiredTextSchema = z.string().trim().min(1).max(500);
const optionalEmailSchema = z.email().nullable();

export const admissionDtoSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  name: z.string(),
  admissionNo: z.string(),
  admissionClassId: z.string().nullable(),
  address: z.string(),
  /**
   * E.164 for new and migrated values; a value the phone backfill could not
   * parse is returned as stored (tolerant read).
   */
  phoneNo: z.string(),
  whatsappNo: z.string().nullable(),
  /** Null: no WhatsApp choice was recorded yet (admission predates the field). */
  whatsappSameAsPhone: z.boolean().nullable(),
  whatsappVerified: z.boolean(),
  whatsappConsent: z.boolean(),
  email: z.string().nullable(),
  dob: z.iso.date(),
  fatherName: z.string(),
  motherName: z.string(),
  registered: z.boolean(),
  unregisteredAt: z.date().nullable(),
  photoS3Key: z.string().nullable(),
  documents: admissionDocumentsSchema,
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});

export type AdmissionDto = z.infer<typeof admissionDtoSchema>;

export function toAdmissionDto(value: AdmissionDto): AdmissionDto {
  return admissionDtoSchema.parse(value);
}

export const listAdmissionsInputSchema = createListInputSchema({
  schoolId: z.string().min(1),
  searchQuery: z.string().trim().min(1).max(200).optional(),
  searchMode: z.enum(["contains", "fuzzy"]).default("contains"),
  filters: z
    .object({
      registered: z.boolean().optional(),
      admissionClassId: z.string().min(1).optional(),
      /** Return admissions which do not yet have a student row in this session. */
      unadmittedForSessionId: z.string().min(1).optional(),
      /** Session used to evaluate the independent classroom-placement filter. */
      placementSessionId: z.string().min(1).optional(),
      placementStatus: z.enum(["assigned", "unassigned"]).optional(),
      /**
       * WhatsApp readiness (D-4, D-8), first failing fact wins, as the
       * WhatsApp channel decides: `no_number` (no WhatsApp number),
       * `not_verified` (number not verified), `no_consent` (verified, no
       * guardian consent), `ready` (all three), `needs_attention` (any of
       * the first three).
       */
      whatsappStatus: z
        .enum(["ready", "needs_attention", "no_number", "not_verified", "no_consent"])
        .optional(),
    })
    .refine(
      ({ placementSessionId, placementStatus }) =>
        placementStatus === undefined || placementSessionId !== undefined,
      {
        message:
          "Placement status requires an explicit placement session.",
      },
    )
    .optional(),
  orderBy: z
    .object({
      field: z.enum([
        "name",
        "admissionNo",
        "dob",
        "createdAt",
        "relevance",
      ]),
      direction: z.enum(["asc", "desc"]).default("asc"),
    })
    .default({ field: "name", direction: "asc" }),
}).superRefine(({ orderBy, searchQuery }, context) => {
  if (orderBy.field !== "relevance") {
    return;
  }

  if (searchQuery === undefined) {
    context.addIssue({
      code: "custom",
      message: "Relevance ordering requires a search query.",
      path: ["orderBy", "field"],
    });
  }

  if (orderBy.direction !== "desc") {
    context.addIssue({
      code: "custom",
      message: "Relevance ordering has a fixed descending direction.",
      path: ["orderBy", "direction"],
    });
  }
});

export const admissionPlacementSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  classId: z.string().nullable(),
  sectionId: z.string().nullable(),
  rollNo: z.number().int().positive().nullable(),
});

export const admissionListItemDtoSchema = admissionDtoSchema.extend({
  placement: admissionPlacementSchema.nullable(),
});

export type AdmissionListItemDto = z.infer<typeof admissionListItemDtoSchema>;

export const listAdmissionsOutputSchema = createPaginatedOutputSchema(
  admissionListItemDtoSchema,
);

export const admissionIdInputSchema = z.object({
  schoolId: z.string().min(1),
  admissionId: z.string().min(1),
});

/** WhatsApp facts accepted on create and update (D-4, D-8). */
const whatsappInputFields = {
  whatsappNo: phoneNumberSchema
    .nullable()
    .optional()
    .describe("WhatsApp number (E.164, or a national Indian number). Must be omitted or equal phoneNo while whatsappSameAsPhone is true; null for no WhatsApp number."),
  whatsappVerified: z
    .boolean()
    .describe("Staff confirmed the WhatsApp number with the guardian. Requires a WhatsApp number."),
  whatsappConsent: z
    .boolean()
    .describe("The guardian consented to receive WhatsApp notifications."),
};

const PHONE_DESCRIPTION =
  "Household phone number. Accepts E.164 (+919876543210) or a national Indian number; stored as E.164.";

export const createAdmissionInputSchema = z.object({
  schoolId: z.string().min(1),
  name: requiredTextSchema,
  admissionNo: requiredTextSchema,
  admissionClassId: z.string().min(1).nullable().optional(),
  address: requiredTextSchema,
  phoneNo: phoneNumberSchema.describe(PHONE_DESCRIPTION),
  /**
   * Explicit choice (D-4): when true the WhatsApp number is the phone number
   * and follows it on later phone changes.
   */
  whatsappSameAsPhone: z
    .boolean()
    .describe("Whether the WhatsApp number is the phone number. When true, whatsappNo is set to phoneNo."),
  whatsappNo: whatsappInputFields.whatsappNo,
  whatsappVerified: whatsappInputFields.whatsappVerified.default(false),
  whatsappConsent: whatsappInputFields.whatsappConsent.default(false),
  email: optionalEmailSchema.optional(),
  dob: z.iso.date(),
  fatherName: requiredTextSchema,
  motherName: requiredTextSchema,
  /** Pricing moved to the restricted billing router; reject stale clients. */
  financeValue: z.never().optional(),
  /**
   * Also issue a Cadet Portal password in the same transaction. Requires the
   * cadet password permission in addition to admission creation; the
   * password is returned once in `cadetPassword`.
   */
  generateCadetPassword: z
    .boolean()
    .default(false)
    .describe("Also issue a Cadet Portal (student portal) password; it is returned once."),
}).superRefine((value, context) => {
  if (value.whatsappSameAsPhone && value.whatsappNo != null && value.whatsappNo !== value.phoneNo) {
    context.addIssue({
      code: "custom",
      path: ["whatsappNo"],
      message: "The WhatsApp number must equal the phone number while it is the same as the phone number.",
    });
  }
  const hasWhatsappNo = value.whatsappSameAsPhone || value.whatsappNo != null;
  if (value.whatsappVerified && !hasWhatsappNo) {
    context.addIssue({
      code: "custom",
      path: ["whatsappVerified"],
      message: "A WhatsApp number can only be verified when there is one.",
    });
  }
});

export const updateAdmissionInputSchema = admissionIdInputSchema
  .extend({
    name: requiredTextSchema.optional(),
    admissionNo: requiredTextSchema.optional(),
    admissionClassId: z.string().min(1).nullable().optional(),
    address: requiredTextSchema.optional(),
    phoneNo: phoneNumberSchema.optional().describe(PHONE_DESCRIPTION),
    whatsappSameAsPhone: z
      .boolean()
      .optional()
      .describe("Whether the WhatsApp number is the phone number. While true, the WhatsApp number follows phoneNo."),
    whatsappNo: whatsappInputFields.whatsappNo,
    whatsappVerified: whatsappInputFields.whatsappVerified.optional(),
    whatsappConsent: whatsappInputFields.whatsappConsent.optional(),
    email: optionalEmailSchema.optional(),
    dob: z.iso.date().optional(),
    fatherName: requiredTextSchema.optional(),
    motherName: requiredTextSchema.optional(),
    /** Pricing moved to the restricted billing router; reject stale clients. */
    financeValue: z.never().optional(),
  })
  .refine(
    ({ schoolId: _schoolId, admissionId: _admissionId, ...changes }) =>
      Object.values(changes).some((value) => value !== undefined),
    { message: "At least one admission field must be provided." },
  );

export const unregisterAdmissionInputSchema = admissionIdInputSchema.extend({
  confirmationName: requiredTextSchema,
});

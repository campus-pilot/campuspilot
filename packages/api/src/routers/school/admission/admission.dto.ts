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
  phoneNo: z.string(),
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
  filters: z
    .object({
      registered: z.boolean().optional(),
      admissionClassId: z.string().min(1).optional(),
      /** Return admissions which do not yet have a student row in this session. */
      unadmittedForSessionId: z.string().min(1).optional(),
      /** Session used to evaluate the independent classroom-placement filter. */
      placementSessionId: z.string().min(1).optional(),
      placementStatus: z.enum(["assigned", "unassigned"]).optional(),
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
      field: z.enum(["name", "admissionNo", "dob", "createdAt"]),
      direction: z.enum(["asc", "desc"]).default("asc"),
    })
    .default({ field: "name", direction: "asc" }),
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

export const createAdmissionInputSchema = z.object({
  schoolId: z.string().min(1),
  name: requiredTextSchema,
  admissionNo: requiredTextSchema,
  admissionClassId: z.string().min(1).nullable().optional(),
  address: requiredTextSchema,
  phoneNo: requiredTextSchema,
  email: optionalEmailSchema.optional(),
  dob: z.iso.date(),
  fatherName: requiredTextSchema,
  motherName: requiredTextSchema,
  /** Pricing moved to the restricted billing router; reject stale clients. */
  financeValue: z.never().optional(),
});

export const updateAdmissionInputSchema = admissionIdInputSchema
  .extend({
    name: requiredTextSchema.optional(),
    admissionNo: requiredTextSchema.optional(),
    admissionClassId: z.string().min(1).nullable().optional(),
    address: requiredTextSchema.optional(),
    phoneNo: requiredTextSchema.optional(),
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

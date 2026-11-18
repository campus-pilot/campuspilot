import { SCHOOL_CREATION_REQUEST_STATUSES } from "@campuspilot/db/schema/school-creation";
import { z } from "zod";

import {
  MAX_REQUESTED_SCHOOL_LIMIT,
  SCHOOL_REQUEST_REASON_MAX,
  SCHOOL_REQUEST_REASON_MIN,
  schoolCreationRefusalSchema,
} from "../../school-creation/school-creation.contract";

/** A person's request for a larger allowance, as they see it. */
export const mySchoolCreationRequestDtoSchema = z.object({
  id: z.string(),
  requestedLimit: z.number().int(),
  reason: z.string(),
  status: z.enum(SCHOOL_CREATION_REQUEST_STATUSES),
  /** The allowance an administrator granted; set only when approved. */
  grantedLimit: z.number().int().nullable(),
  /** What the administrator wrote with the decision. */
  decisionNote: z.string().nullable(),
  decidedAt: z.date().nullable(),
  createdAt: z.date(),
});

/**
 * Whether the signed-in person may create a school, with the facts it is
 * decided from (docs/school-creation.md).
 */
export const schoolCreationStatusDtoSchema = z.object({
  /** Schools the person may create over the life of the account. */
  limit: z.number().int(),
  /** Schools the person created so far, including deleted, handed over or left ones. */
  used: z.number().int(),
  /** Why the person may not create a school now; null when they may. */
  refusal: schoolCreationRefusalSchema.nullable(),
  /** The person's newest request for more schools, or null when they never asked. */
  latestRequest: mySchoolCreationRequestDtoSchema.nullable(),
});
export type SchoolCreationStatusDto = z.infer<typeof schoolCreationStatusDtoSchema>;

export const createOwnSchoolInputSchema = z.object({
  name: z.string().trim().min(2, "Enter the school's name.").max(120),
  location: z.string().trim().min(2, "Enter where the school is.").max(200),
  /** The school's government registration number, when it has one. */
  registrationNo: z.string().trim().max(60).nullable().optional(),
});

export const createOwnSchoolOutputSchema = z.object({ schoolId: z.string() });

export const requestMoreSchoolsInputSchema = z.object({
  /** The total number of schools the person wants to be able to create, not the number of extra ones. */
  requestedLimit: z.number().int().min(2).max(MAX_REQUESTED_SCHOOL_LIMIT),
  reason: z
    .string()
    .trim()
    .min(SCHOOL_REQUEST_REASON_MIN, `Tell us a little more (at least ${SCHOOL_REQUEST_REASON_MIN} characters).`)
    .max(SCHOOL_REQUEST_REASON_MAX),
});

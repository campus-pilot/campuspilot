import { SCHOOL_CREATION_REQUEST_STATUSES } from "@campuspilot/db/schema/school-creation";
import { z } from "zod";

import {
  createListInputSchema,
  createPaginatedOutputSchema,
} from "../../../paginations";
import { MAX_GRANTED_SCHOOL_LIMIT } from "../../../school-creation/school-creation.contract";

export const schoolCreationRequestStatusSchema = z.enum(SCHOOL_CREATION_REQUEST_STATUSES);

/** A school a person created themselves, as the admin app lists it next to their request. */
const createdSchoolSchema = z.object({
  /** Null once the school was deleted; the creation still counts. */
  schoolId: z.string().nullable(),
  name: z.string().nullable(),
  createdAt: z.date(),
});

/**
 * A request for a larger school allowance, with what an administrator needs
 * to decide it: who asked, their current allowance and every school they
 * created (docs/school-creation.md).
 */
export const schoolCreationRequestDtoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  /** Null when the account has no email of its own (phone-only sign-in). */
  email: z.email().nullable(),
  phoneNumber: z.string().nullable(),
  requestedLimit: z.number().int(),
  reason: z.string(),
  status: schoolCreationRequestStatusSchema,
  grantedLimit: z.number().int().nullable(),
  decisionNote: z.string().nullable(),
  decidedAt: z.date().nullable(),
  createdAt: z.date(),
  /** The person's allowance today (it may have changed since they asked). */
  currentLimit: z.number().int(),
  /** Every school the person created, oldest first, deleted ones included. */
  createdSchools: z.array(createdSchoolSchema),
});
export type SchoolCreationRequestDto = z.infer<typeof schoolCreationRequestDtoSchema>;

export const listSchoolCreationRequestsInputSchema = createListInputSchema({
  /** Only requests in this state; every request when left out. */
  status: schoolCreationRequestStatusSchema.optional(),
});

export const listSchoolCreationRequestsOutputSchema = createPaginatedOutputSchema(
  schoolCreationRequestDtoSchema,
);

export const decideSchoolCreationRequestInputSchema = z.discriminatedUnion("decision", [
  z.object({
    id: z.string().min(1),
    decision: z.literal("approve"),
    /** The person's new allowance (a total); it may differ from what they asked. */
    grantedLimit: z.number().int().min(1).max(MAX_GRANTED_SCHOOL_LIMIT),
    note: z.string().trim().max(1000).optional(),
  }),
  z.object({
    id: z.string().min(1),
    decision: z.literal("reject"),
    note: z.string().trim().max(1000).optional(),
  }),
]);

export const countPendingSchoolCreationRequestsOutputSchema = z.object({ pending: z.number().int() });

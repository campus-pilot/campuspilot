import { entityIdSchema } from '@campuspilot/db/id';
import { z } from 'zod';

import { createListInputSchema, createPaginatedOutputSchema } from '../../../paginations';

export const listSchoolRegistrationRequestsInputSchema = createListInputSchema({
  /** Matches the school name, phone, email or address answers. */
  searchQuery: z.string().trim().max(100).default(''),
});

/** A stored file of a request, without its storage key; read it through `getSchoolRegistrationRequestMedia`. */
const storedFileSchema = z.object({ contentType: z.string(), bytes: z.number().int().nonnegative() });

/**
 * One School Onboarding form submission as platform admins read it.
 * `response` is the stored answers JSON as submitted (see
 * `leads/school-onboarding.ts`); `logo` and `voiceNote` are null when the
 * school sent none.
 */
export const schoolRegistrationRequestDtoSchema = z.object({
  id: z.string(),
  formVersion: z.number().int(),
  response: z.record(z.string(), z.unknown()),
  logo: storedFileSchema.nullable(),
  voiceNote: storedFileSchema.nullable(),
  sourcePath: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.date(),
});
export type SchoolRegistrationRequestDto = z.infer<typeof schoolRegistrationRequestDtoSchema>;

export const listSchoolRegistrationRequestsOutputSchema = createPaginatedOutputSchema(schoolRegistrationRequestDtoSchema);

export const getSchoolRegistrationRequestMediaInputSchema = z.object({
  requestId: entityIdSchema('schoolRegistrationRequest'),
});

/** Short-lived presigned URLs of a request's files; null for a file it does not have. */
export const getSchoolRegistrationRequestMediaOutputSchema = z.object({
  logoUrl: z.string().nullable(),
  voiceNoteUrl: z.string().nullable(),
  expiresAt: z.date(),
});

import { z } from 'zod';

/**
 * The contract of personal spaces (docs/personal-space.md), importable by the
 * browser apps (Zod only).
 *
 * A personal space is a school of kind `personal` that belongs to one person
 * and holds only standalone question papers. Whether a person may get one is
 * decided from separate facts, each read on its own, in this order (the first
 * that applies is the refusal):
 *
 * 1. `demo_account`: the account exists only for a demo school
 *    (`user.demo_school_id`).
 * 2. `no_google_account`: no Google account is linked to the person (an
 *    `account` row with `provider_id = 'google'`). Read from that row, never
 *    from `user.email_verified`: a school invitation marks the email verified
 *    too, and an invited person never gets a personal space through that.
 * 3. `already_has_one`: the person has had their personal space: one over
 *    the life of the account, decided from `user.personal_space_created_at`
 *    (set when it was created, never cleared), so deleting the space does not
 *    make the person eligible again. A partial unique index backs up one live
 *    space per owner.
 * 4. `member_of_school`: the person is a member of a school, any school. A
 *    member of a school is never given a personal space, neither by the
 *    sign-up nor by the button, so it is offered only to someone who has no
 *    school at all.
 *
 * A personal space does not use the person's school creation allowance: no
 * `school_creation` row is written and the allowance's refusals do not apply.
 */
export const PERSONAL_SPACE_REFUSALS = ['demo_account', 'no_google_account', 'already_has_one', 'member_of_school'] as const;
export const personalSpaceRefusalSchema = z.enum(PERSONAL_SPACE_REFUSALS);
export type PersonalSpaceRefusal = z.infer<typeof personalSpaceRefusalSchema>;

/** What the person is told for each refusal, in the app and in the API error. */
export const PERSONAL_SPACE_REFUSAL_MESSAGES = {
  demo_account: 'Demo accounts cannot have a personal space.',
  no_google_account: 'Sign in with Google to create your personal space.',
  already_has_one: 'You already have a personal space. Each person gets one.',
  member_of_school: 'You are a member of a school, so a personal space is not offered to you.',
} as const satisfies Record<PersonalSpaceRefusal, string>;

/** `data.reason` of the FORBIDDEN error that refuses creating a personal space. */
export const PERSONAL_SPACE_REFUSED_REASON = 'PERSONAL_SPACE_REFUSED';

export const personalSpaceRefusedDataSchema = z.object({
  reason: z.literal(PERSONAL_SPACE_REFUSED_REASON),
  refusal: personalSpaceRefusalSchema,
});

/** The refusal a caught API error carries, or null for any other error. */
export function personalSpaceRefusalOf(error: unknown): PersonalSpaceRefusal | null {
  if (typeof error !== 'object' || error === null) return null;
  if (!('code' in error) || error.code !== 'FORBIDDEN') return null;
  if (!('data' in error)) return null;
  const parsed = personalSpaceRefusedDataSchema.safeParse(error.data);
  return parsed.success ? parsed.data.refusal : null;
}

/** The name a person without a display name gets for their personal space. */
export const UNNAMED_PERSONAL_SPACE_NAME = 'My personal school';

/**
 * The name of a person's personal space: "{name}'s personal school", or
 * {@link UNNAMED_PERSONAL_SPACE_NAME} when the person has no name. Their name
 * is used as it is now; renaming the account later does not rename the space.
 */
export function personalSpaceName(userName: string | null | undefined): string {
  const name = (userName ?? '').replace(/\s+/g, ' ').trim();
  return name === '' ? UNNAMED_PERSONAL_SPACE_NAME : `${name}'s personal school`;
}

/** `personalSpace.getStatus`: the person's personal space, if any, and whether they may create one now. */
export const personalSpaceStatusDtoSchema = z.object({
  /** The person's personal space; null when they have none. */
  schoolId: z.string().nullable(),
  /** Why they may not create one now; null when they may. */
  refusal: personalSpaceRefusalSchema.nullable(),
});
export type PersonalSpaceStatusDto = z.infer<typeof personalSpaceStatusDtoSchema>;

export const createPersonalSpaceOutputSchema = z.object({ schoolId: z.string() });

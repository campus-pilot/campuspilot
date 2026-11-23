import { phoneNumberSchema } from '@campuspilot/db/phone';
import { z } from 'zod';

/**
 * The School Onboarding form: a standalone, unlinked website page
 * (`/onboarding`) where a school sends what we need to set it up (name,
 * logo, contact, address, classes with their sections and subjects, and any
 * extra notes as text or a recorded voice note). Shared by the API and the
 * web app, so both accept exactly the same answers. Kept free of server
 * imports: the web bundle imports this file.
 *
 * The answers are stored as `school_registration_request.response` JSON;
 * the logo and voice note are S3 objects named on the row. Bump
 * {@link SCHOOL_ONBOARDING_FORM_VERSION} when a question's meaning changes.
 */

/** `school_registration_request.form_version` of the current questions. */
export const SCHOOL_ONBOARDING_FORM_VERSION = 1;

/** Classes offered as ready-made choices, in school order. A school may add others. */
export const DEFAULT_CLASS_NAMES = [
  'Nursery',
  'LKG',
  'UKG',
  ...Array.from({ length: 12 }, (_, index) => `Class ${index + 1}`),
] as const;

/** Sections offered for every class. A school may add others. */
export const DEFAULT_SECTION_NAMES = ['A', 'B', 'C', 'D'] as const;

/** Subjects offered for every class. A school may add others. */
export const DEFAULT_SUBJECT_NAMES = ['Mathematics', 'English', 'Hindi', 'SST', 'Science', 'ECA', 'Sanskrit'] as const;

/** Longest class, section or subject name, typed or chosen. */
export const MAX_NAME_LENGTH = 40;
export const MAX_CLASSES = 40;
export const MAX_SECTIONS_PER_CLASS = 26;
export const MAX_SUBJECTS_PER_CLASS = 30;
export const MAX_NOTES_LENGTH = 5_000;

/** Largest logo accepted (JPEG, PNG or WebP, recognised by its bytes). */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const LOGO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * Longest voice note. The browser stops recording here; the server cannot
 * measure the length of compressed audio cheaply, so it holds the note to
 * {@link MAX_VOICE_NOTE_BYTES} and the reported length to this.
 */
export const MAX_VOICE_NOTE_SECONDS = 10 * 60;
/**
 * Bitrate the browser is asked to record at. At 64 kbps ten minutes is about
 * 4.8 MB; browsers that ignore the request (Safari records AAC at up to about
 * 128 kbps, 9.6 MB) still fit {@link MAX_VOICE_NOTE_BYTES}.
 */
export const VOICE_NOTE_BITS_PER_SECOND = 64_000;
export const MAX_VOICE_NOTE_BYTES = 12 * 1024 * 1024;
/** Containers browsers record into: WebM (Chrome, Firefox), Ogg (older Firefox), MP4 (Safari). */
export const VOICE_NOTE_MIME_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4'] as const;

/** Multipart field names of `POST /public/leads/school-onboarding`. */
export const SCHOOL_ONBOARDING_FIELDS = { submission: 'submission', logo: 'logo', voiceNote: 'voiceNote' } as const;

/** A class, section or subject name: trimmed, inner spaces collapsed. */
const nameSchema = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1, 'Enter a name.').max(MAX_NAME_LENGTH, `Use at most ${MAX_NAME_LENGTH} characters.`));

/** Names compared as a person reads them: "class 1" and "Class 1" are the same class. */
function hasDuplicates(names: string[]) {
  return new Set(names.map((name) => name.toLowerCase())).size !== names.length;
}

/** One class the school runs, with the sections and subjects it has. */
export const onboardingClassSchema = z
  .object({
    name: nameSchema,
    sections: z.array(nameSchema).min(1, 'Choose at least one section.').max(MAX_SECTIONS_PER_CLASS),
    subjects: z.array(nameSchema).min(1, 'Choose at least one subject.').max(MAX_SUBJECTS_PER_CLASS),
  })
  .superRefine((value, context) => {
    if (hasDuplicates(value.sections)) context.addIssue({ code: 'custom', path: ['sections'], message: 'Each section must be listed once.' });
    if (hasDuplicates(value.subjects)) context.addIssue({ code: 'custom', path: ['subjects'], message: 'Each subject must be listed once.' });
  });
export type OnboardingClass = z.output<typeof onboardingClassSchema>;

/**
 * The answers of one School Onboarding form.
 *
 * - `email`: optional; the page asks for a Gmail address (the account the
 *   school will sign in with) but any valid address is accepted.
 * - `notes`: anything else, typed. A voice note is its own file, described
 *   by `voiceNoteSeconds` (its length as the browser recorded it, null when
 *   there is none). Whether a logo or voice note was sent is read from the
 *   stored files, never from the answers.
 */
export const schoolOnboardingResponseSchema = z
  .object({
    schoolName: z.string().trim().min(2, 'Enter the school name.').max(160, 'Use at most 160 characters.'),
    phone: phoneNumberSchema,
    email: z
      .string()
      .trim()
      .max(254)
      .nullable()
      .transform((value) => (value ? value : null))
      .pipe(z.email('Enter a valid email address.').nullable()),
    address: z.string().trim().min(5, 'Enter the school address.').max(1_000, 'Use at most 1,000 characters.'),
    classes: z.array(onboardingClassSchema).min(1, 'Choose at least one class.').max(MAX_CLASSES),
    notes: z
      .string()
      .trim()
      .max(MAX_NOTES_LENGTH)
      .nullable()
      .transform((value) => (value ? value : null)),
    voiceNoteSeconds: z.number().int().min(1).max(MAX_VOICE_NOTE_SECONDS).nullable(),
  })
  .superRefine((value, context) => {
    if (hasDuplicates(value.classes.map((schoolClass) => schoolClass.name))) {
      context.addIssue({ code: 'custom', path: ['classes'], message: 'Each class must be listed once.' });
    }
  });
export type SchoolOnboardingResponse = z.output<typeof schoolOnboardingResponseSchema>;
export type SchoolOnboardingResponseInput = z.input<typeof schoolOnboardingResponseSchema>;

/**
 * The `submission` field of `POST /public/leads/school-onboarding`.
 * `submissionId` is generated once per form fill in the browser; resending it
 * (a retry after a lost response) returns the request already saved.
 */
export const schoolOnboardingSubmissionSchema = z.object({
  submissionId: z.uuid(),
  sourcePath: z.string().max(200).startsWith('/').nullable().optional(),
  response: schoolOnboardingResponseSchema,
});
export type SchoolOnboardingSubmission = z.input<typeof schoolOnboardingSubmissionSchema>;

/**
 * Public route of the form (see `apps/server/src/http.ts`). It lives under
 * `/public/leads/` so it shares the lead form's CORS rule and its
 * proof-of-work challenge (`LEAD_CHALLENGE_PATH`).
 */
export const SCHOOL_ONBOARDING_PATH = '/public/leads/school-onboarding';

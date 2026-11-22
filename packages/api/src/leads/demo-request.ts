import { phoneNumberSchema } from '@campuspilot/db/phone';
import { z } from 'zod';

/**
 * The website's demo request form ("Contact us", `/contact`). Shared by the API and the
 * web app, so both accept exactly the same answers. Kept free of server
 * imports: the web bundle imports this file.
 *
 * The answers are stored as the lead's `response` JSON. Adding or changing a
 * question needs no migration, but bump {@link DEMO_REQUEST_FORM_VERSION}
 * when a question's meaning changes, so older answers stay readable.
 */

/** `lead.form` of a demo request. */
export const DEMO_REQUEST_FORM = 'book_demo';
/** `lead.form_version` of the current questions. */
export const DEMO_REQUEST_FORM_VERSION = 1;

/** How the school would like to be contacted. */
export const PREFERRED_CONTACT_METHODS = ['phone_call', 'whatsapp'] as const;
export type PreferredContactMethod = (typeof PREFERRED_CONTACT_METHODS)[number];
export const PREFERRED_CONTACT_LABELS: Record<PreferredContactMethod, string> = {
  phone_call: 'Phone call',
  whatsapp: 'WhatsApp',
};

/** Largest school size accepted; rough answers, but not unbounded ones. */
export const MAX_APPROX_STUDENTS = 100_000;
export const MAX_APPROX_STAFF = 10_000;

/** An optional text answer: blank becomes null. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value ? value : null));
}

/**
 * The answers of one demo request.
 *
 * - `hasWhatsAppOnPhone`: whether `phone` is also the person's WhatsApp
 *   number. When it is, `whatsappNumber` is set to `phone` here, whatever
 *   the client sent, so the stored JSON always names the WhatsApp number
 *   explicitly. When it is not, `whatsappNumber` is the separate number they
 *   gave, or null.
 * - `preferredContact`: `whatsapp` needs a WhatsApp number.
 * - `approxStudents` / `approxStaff`: rough counts the person estimates;
 *   never taken as exact.
 */
export const demoRequestResponseSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your name.').max(120),
    phone: phoneNumberSchema,
    hasWhatsAppOnPhone: z.boolean(),
    whatsappNumber: phoneNumberSchema.nullable(),
    email: z
      .string()
      .trim()
      .max(254)
      .nullable()
      .transform((value) => (value ? value : null))
      .pipe(z.email('Enter a valid email address.').nullable()),
    preferredContact: z.enum(PREFERRED_CONTACT_METHODS),
    schoolName: optionalText(160),
    approxStudents: z.number().int().min(1).max(MAX_APPROX_STUDENTS),
    approxStaff: z.number().int().min(1).max(MAX_APPROX_STAFF),
  })
  .transform((value) => ({ ...value, whatsappNumber: value.hasWhatsAppOnPhone ? value.phone : value.whatsappNumber }))
  .superRefine((value, context) => {
    if (value.preferredContact === 'whatsapp' && !value.whatsappNumber) {
      context.addIssue({ code: 'custom', path: ['whatsappNumber'], message: 'Add your WhatsApp number, or choose a phone call.' });
    }
  });
export type DemoRequestResponse = z.output<typeof demoRequestResponseSchema>;
export type DemoRequestResponseInput = z.input<typeof demoRequestResponseSchema>;

/**
 * The body of `POST /public/leads/demo-request`. `submissionId` is generated
 * once per form fill in the browser; resending it (a retry after a lost
 * response) returns the lead already saved.
 */
export const demoRequestSubmissionSchema = z.object({
  submissionId: z.uuid(),
  sourcePath: z.string().max(200).startsWith('/').nullable().optional(),
  response: demoRequestResponseSchema,
});
export type DemoRequestSubmission = z.input<typeof demoRequestSubmissionSchema>;

/** Public routes of the lead form (see `apps/server/src/http.ts`). */
export const LEAD_CHALLENGE_PATH = '/public/leads/challenge';
export const DEMO_REQUEST_PATH = '/public/leads/demo-request';
/** Request header carrying the solved proof-of-work (base64 JSON, ALTCHA format). */
export const PROOF_OF_WORK_HEADER = 'x-altcha';

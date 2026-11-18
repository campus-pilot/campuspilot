import {
  MAX_APPROX_STAFF,
  MAX_APPROX_STUDENTS,
  PREFERRED_CONTACT_LABELS,
  PREFERRED_CONTACT_METHODS,
  type DemoRequestSubmission,
  type PreferredContactMethod,
} from "@campuspilot/api/leads/demo-request";
import {
  phoneInputValueFromStored,
  phoneInputValueSchema,
  phoneInputValueToE164,
  requiredPhoneInputSchema,
  type PhoneInputValue,
} from "@campuspilot/components/phone-input";
import { useForm } from "@tanstack/react-form";
import { ArrowLeft, ArrowRight, CheckCircle2, LoaderCircle, MessageCircle, Phone, type LucideIcon } from "lucide-react";
import { z } from "zod";

import { channels } from "@/pages/contact-channels/channels";
import { submitDemoRequest } from "./demo-request-submit";
import { SitePhoneInput } from "./phone-field-input";

/**
 * Where the form is: the person's contact details, then their school, then
 * the thank-you note once the lead is saved. A form value, so every state
 * the card shows derives from the form.
 */
type Step = "contact" | "school" | "sent";

const CONTACT_ICONS: Record<PreferredContactMethod, LucideIcon> = { phone_call: Phone, whatsapp: MessageCircle };

/** A whole number typed as text, within 1 and `max`; null when it is not one. */
function roughCount(value: string, max: number): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  const count = Number(trimmed);
  return count >= 1 && count <= max ? count : null;
}

/**
 * The form's checks. The school questions are checked only on the second
 * step, so "Continue" validates the contact details alone. The API checks
 * the same answers again with `demoRequestResponseSchema`.
 */
const demoRequestFormSchema = z
  .object({
    step: z.enum(["contact", "school", "sent"]),
    submissionId: z.string(),
    name: z.string().trim().min(2, "Enter your name."),
    phone: requiredPhoneInputSchema("Enter your phone number."),
    hasWhatsAppOnPhone: z.boolean(),
    whatsapp: phoneInputValueSchema,
    email: z.string().trim().max(254),
    preferredContact: z.enum(PREFERRED_CONTACT_METHODS).nullable(),
    schoolName: z.string().max(160, "Use at most 160 characters."),
    approxStudents: z.string(),
    approxStaff: z.string(),
  })
  .superRefine((value, context) => {
    if (value.email.trim() && !z.email().safeParse(value.email.trim()).success) {
      context.addIssue({ code: "custom", path: ["email"], message: "Enter a valid email address, or leave it empty." });
    }
    if (!value.preferredContact) context.addIssue({ code: "custom", path: ["preferredContact"], message: "Choose how we should reach you." });
    if (!value.hasWhatsAppOnPhone) {
      const typed = value.whatsapp.number.trim();
      if (typed && !phoneInputValueToE164(value.whatsapp)) {
        context.addIssue({ code: "custom", path: ["whatsapp"], message: "Enter a valid WhatsApp number." });
      } else if (!typed && value.preferredContact === "whatsapp") {
        context.addIssue({ code: "custom", path: ["whatsapp"], message: "Add your WhatsApp number, or choose a phone call." });
      }
    }
    if (value.step !== "school") return;
    if (roughCount(value.approxStudents, MAX_APPROX_STUDENTS) === null) {
      context.addIssue({ code: "custom", path: ["approxStudents"], message: "Enter a rough number of students." });
    }
    if (roughCount(value.approxStaff, MAX_APPROX_STAFF) === null) {
      context.addIssue({ code: "custom", path: ["approxStaff"], message: "Enter a rough number of staff." });
    }
  });

type DemoRequestFormValues = z.input<typeof demoRequestFormSchema>;

/** The API body for validated form values. */
function toSubmission(value: DemoRequestFormValues): DemoRequestSubmission {
  return {
    submissionId: value.submissionId,
    sourcePath: typeof window === "undefined" ? null : window.location.pathname,
    response: {
      name: value.name.trim(),
      phone: phoneInputValueToE164(value.phone) ?? "",
      hasWhatsAppOnPhone: value.hasWhatsAppOnPhone,
      // The API stores the phone itself as the WhatsApp number when they are the same.
      whatsappNumber: value.hasWhatsAppOnPhone ? null : phoneInputValueToE164(value.whatsapp),
      email: value.email.trim() || null,
      preferredContact: value.preferredContact ?? "phone_call",
      schoolName: value.schoolName.trim() || null,
      approxStudents: roughCount(value.approxStudents, MAX_APPROX_STUDENTS) ?? 0,
      approxStaff: roughCount(value.approxStaff, MAX_APPROX_STAFF) ?? 0,
    },
  };
}

/** An empty number under the default country (India). */
const emptyPhone = (): PhoneInputValue => phoneInputValueFromStored(null);

/**
 * The demo request form. "Continue" on the first step only validates and
 * moves on; on the second, submitting solves the proof-of-work and saves the
 * lead, retrying lost tries with the same submission id
 * (`demo-request-submit.ts`). A failure keeps every answer and offers a
 * retry plus the direct channels.
 */
function useDemoRequestForm() {
  const form = useForm({
    defaultValues: {
      step: "contact" as Step,
      // Drawn on the first send of this fill; every retry reuses it.
      submissionId: "",
      name: "",
      phone: emptyPhone(),
      hasWhatsAppOnPhone: true,
      whatsapp: emptyPhone(),
      email: "",
      preferredContact: null as PreferredContactMethod | null,
      schoolName: "",
      approxStudents: "",
      approxStaff: "",
    },
    validators: { onSubmit: demoRequestFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      if (value.step === "contact") {
        form.setFieldValue("step", "school");
        return;
      }
      const submissionId = value.submissionId || crypto.randomUUID();
      form.setFieldValue("submissionId", submissionId);
      const outcome = await submitDemoRequest(toSubmission({ ...value, submissionId }));
      if (outcome.kind === "saved") {
        form.setFieldValue("step", "sent");
        return;
      }
      const message =
        outcome.kind === "invalid"
          ? "Some answers could not be accepted. Check them and try again."
          : "We could not send your request just now. Try again, or reach us directly below.";
      form.setErrorMap({ onSubmit: { form: message, fields: {} } });
    },
  });
  return form;
}

type DemoRequestFormApi = ReturnType<typeof useDemoRequestForm>;

/** The first error of a field, as TanStack Form keeps it (a string or a Standard Schema issue). */
function firstError(errors: unknown[]): string | null {
  const error = errors[0];
  if (!error) return null;
  if (typeof error === "string") return error;
  return (error as { message?: string }).message ?? null;
}

function FieldError({ id, errors }: { id: string; errors: unknown[] }) {
  const message = firstError(errors);
  return message ? (
    <p id={id} className="pg-book-form-error" role="alert">
      {message}
    </p>
  ) : null;
}

function FieldLabel({ htmlFor, children, optional = false }: { htmlFor: string; children: React.ReactNode; optional?: boolean }) {
  return (
    <label className="pg-book-form-label" htmlFor={htmlFor}>
      {children}
      {optional ? <span>Optional</span> : null}
    </label>
  );
}

function TextField({
  form,
  name,
  label,
  hint,
  optional,
  inputMode,
  autoComplete,
  placeholder,
}: {
  form: DemoRequestFormApi;
  name: "name" | "email" | "schoolName" | "approxStudents" | "approxStaff";
  label: string;
  hint?: string;
  optional?: boolean;
  inputMode?: "text" | "email" | "numeric";
  autoComplete?: string;
  placeholder?: string;
}) {
  const id = `pg-book-${name}`;
  return (
    <form.Field name={name}>
      {(field) => (
        <div className="pg-book-form-field">
          <FieldLabel htmlFor={id} optional={optional}>
            {label}
          </FieldLabel>
          <input
            id={id}
            className="pg-book-form-input"
            value={field.state.value}
            inputMode={inputMode}
            type={inputMode === "email" ? "email" : "text"}
            autoComplete={autoComplete}
            placeholder={placeholder}
            aria-invalid={field.state.meta.errors.length > 0 || undefined}
            aria-describedby={`${id}-error`}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
          />
          {hint ? <small className="pg-book-form-hint">{hint}</small> : null}
          <FieldError id={`${id}-error`} errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}

function PhoneField({ form, name, label, optional }: { form: DemoRequestFormApi; name: "phone" | "whatsapp"; label: string; optional?: boolean }) {
  const id = `pg-book-${name}`;
  return (
    <form.Field name={name}>
      {(field) => (
        <div className="pg-book-form-field">
          <FieldLabel htmlFor={id} optional={optional}>
            {label}
          </FieldLabel>
          <SitePhoneInput
            id={id}
            value={field.state.value}
            invalid={field.state.meta.errors.length > 0}
            describedBy={`${id}-error`}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
          />
          <FieldError id={`${id}-error`} errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}

/** "I use WhatsApp on this number"; unticked, a separate WhatsApp number field appears. */
function WhatsAppFields({ form }: { form: DemoRequestFormApi }) {
  return (
    <form.Field name="hasWhatsAppOnPhone">
      {(field) => (
        <>
          <label className="pg-book-form-check" htmlFor="pg-book-has-whatsapp">
            <input
              id="pg-book-has-whatsapp"
              type="checkbox"
              checked={field.state.value}
              onChange={(event) => field.handleChange(event.target.checked)}
            />
            I use WhatsApp on this number
          </label>
          {field.state.value ? null : <PhoneField form={form} name="whatsapp" label="WhatsApp number" optional />}
        </>
      )}
    </form.Field>
  );
}

function ContactChoice({ method, checked, onSelect }: { method: PreferredContactMethod; checked: boolean; onSelect: () => void }) {
  const Icon = CONTACT_ICONS[method];
  return (
    <label className="pg-book-form-choice" data-checked={checked || undefined}>
      <input type="radio" name="preferredContact" value={method} checked={checked} onChange={onSelect} />
      <Icon aria-hidden="true" />
      {PREFERRED_CONTACT_LABELS[method]}
    </label>
  );
}

function PreferredContactField({ form }: { form: DemoRequestFormApi }) {
  return (
    <form.Field name="preferredContact">
      {(field) => (
        <fieldset className="pg-book-form-field" aria-describedby="pg-book-contact-error">
          <legend className="pg-book-form-label">How should we reach you?</legend>
          <div className="pg-book-form-choices">
            {PREFERRED_CONTACT_METHODS.map((method) => (
              <ContactChoice key={method} method={method} checked={field.state.value === method} onSelect={() => field.handleChange(method)} />
            ))}
          </div>
          <FieldError id="pg-book-contact-error" errors={field.state.meta.errors} />
        </fieldset>
      )}
    </form.Field>
  );
}

function ContactStep({ form }: { form: DemoRequestFormApi }) {
  return (
    <>
      <TextField form={form} name="name" label="Your name" autoComplete="name" />
      <PhoneField form={form} name="phone" label="Phone number" />
      <WhatsAppFields form={form} />
      <TextField form={form} name="email" label="Email" optional inputMode="email" autoComplete="email" />
      <PreferredContactField form={form} />
    </>
  );
}

function SchoolStep({ form }: { form: DemoRequestFormApi }) {
  return (
    <>
      <TextField form={form} name="schoolName" label="School name" optional autoComplete="organization" />
      <div className="pg-book-form-pair">
        <TextField form={form} name="approxStudents" label="Approx. students" inputMode="numeric" placeholder="e.g. 450" />
        <TextField form={form} name="approxStaff" label="Approx. staff" inputMode="numeric" placeholder="e.g. 30" />
      </div>
      <small className="pg-book-form-hint">Rough numbers are fine; no need to check your records.</small>
    </>
  );
}

function StepHeader({ step }: { step: Step }) {
  const school = step === "school";
  return (
    <div className="pg-book-form-head">
      <span className="pg-book-form-progress">Step {school ? 2 : 1} of 2</span>
      <h2 id="pg-book-form-title">{school ? "About your school" : "Request a demo"}</h2>
      <p>{school ? "Two quick numbers so we can tailor the walkthrough." : "Tell us who to talk to. It takes under a minute."}</p>
    </div>
  );
}

function FormError({ form }: { form: DemoRequestFormApi }) {
  return (
    <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
      {(error) =>
        typeof error === "string" ? (
          <p className="pg-book-form-alert" role="alert">
            {error} <a href={channels.whatsapp.href} target="_blank" rel="noreferrer">WhatsApp</a> ·{" "}
            <a href={channels.phone.href}>Call {channels.phone.value}</a>
          </p>
        ) : null
      }
    </form.Subscribe>
  );
}

function FormActions({ form, step }: { form: DemoRequestFormApi; step: Step }) {
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <div className="pg-book-form-actions">
          {step === "school" ? (
            <button type="button" className="cp-btn cp-btn-light" disabled={isSubmitting} onClick={() => form.setFieldValue("step", "contact")}>
              <ArrowLeft aria-hidden="true" /> Back
            </button>
          ) : null}
          <button type="submit" className="cp-btn cp-btn-primary" disabled={isSubmitting}>
            {isSubmitting ? <LoaderCircle className="pg-book-spin" aria-hidden="true" /> : null}
            {isSubmitting ? "Sending…" : step === "school" ? "Request my demo" : "Continue"}
            {isSubmitting ? null : <ArrowRight aria-hidden="true" />}
          </button>
        </div>
      )}
    </form.Subscribe>
  );
}

/** Shown once the lead is saved; it names the channel the person chose. */
function SentNote({ form }: { form: DemoRequestFormApi }) {
  return (
    <form.Subscribe selector={(state) => ({ name: state.values.name.trim(), contact: state.values.preferredContact })}>
      {({ name, contact }) => (
        <div className="pg-book-form-sent" role="status">
          <CheckCircle2 aria-hidden="true" />
          <h2 id="pg-book-form-title">Thanks{name ? `, ${name.split(/\s+/)[0]}` : ""}. Your request is in.</h2>
          <p>
            We'll {contact === "whatsapp" ? "message you on WhatsApp" : "call you"} within one working day to set up a 30-minute walkthrough at a
            time that suits your school.
          </p>
        </div>
      )}
    </form.Subscribe>
  );
}

function DemoRequestSteps({ form, step }: { form: DemoRequestFormApi; step: Step }) {
  return (
    <form
      className="pg-book-form-body"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <StepHeader step={step} />
      {step === "school" ? <SchoolStep form={form} /> : <ContactStep form={form} />}
      <FormError form={form} />
      <FormActions form={form} step={step} />
    </form>
  );
}

/** The hero's demo request card: the page's main action. */
export function DemoRequestCard() {
  const form = useDemoRequestForm();
  return (
    <section className="pg-book-form" id="request" aria-labelledby="pg-book-form-title">
      <form.Subscribe selector={(state) => state.values.step}>
        {(step) => (step === "sent" ? <SentNote form={form} /> : <DemoRequestSteps form={form} step={step} />)}
      </form.Subscribe>
    </section>
  );
}

import { SitePhoneInput } from "@/pages/contact/phone-field-input";

import { FieldError, FieldLabel, firstError } from "./field-parts";
import type { OnboardingFormApi } from "./onboarding-form";

function PhoneField({ form }: { form: OnboardingFormApi }) {
  return (
    <form.Field name="phone">
      {(field) => (
        <div className="pg-book-form-field">
          <FieldLabel htmlFor="ob-phone">Phone number</FieldLabel>
          <SitePhoneInput
            id="ob-phone"
            value={field.state.value}
            invalid={field.state.meta.errors.length > 0}
            describedBy="ob-phone-error"
            onBlur={field.handleBlur}
            onChange={field.handleChange}
          />
          <FieldError id="ob-phone-error" message={firstError(field.state.meta.errors)} />
        </div>
      )}
    </form.Field>
  );
}

function EmailField({ form }: { form: OnboardingFormApi }) {
  return (
    <form.Field name="email">
      {(field) => (
        <div className="pg-book-form-field">
          <FieldLabel htmlFor="ob-email" optional>
            Gmail address
          </FieldLabel>
          <input
            id="ob-email"
            className="pg-book-form-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="school@gmail.com"
            value={field.state.value}
            aria-invalid={field.state.meta.errors.length > 0 || undefined}
            aria-describedby="ob-email-hint ob-email-error"
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
          />
          <small id="ob-email-hint" className="pg-book-form-hint">
            The Google account you would like to sign in with. Any other email works too.
          </small>
          <FieldError id="ob-email-error" message={firstError(field.state.meta.errors)} />
        </div>
      )}
    </form.Field>
  );
}

export function ContactStep({ form }: { form: OnboardingFormApi }) {
  return (
    <>
      <PhoneField form={form} />
      <EmailField form={form} />
    </>
  );
}

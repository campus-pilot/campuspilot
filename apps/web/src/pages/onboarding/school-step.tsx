import { MAX_LOGO_BYTES } from "@campuspilot/api/leads/school-onboarding";
import { ImageUp, X } from "lucide-react";

import { FieldError, FieldLabel, firstError } from "./field-parts";
import type { OnboardingFormApi } from "./onboarding-form";
import { logoProblem, type PickedLogo } from "./onboarding-model";

function fileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function SchoolNameField({ form }: { form: OnboardingFormApi }) {
  return (
    <form.Field name="schoolName">
      {(field) => (
        <div className="pg-book-form-field">
          <FieldLabel htmlFor="ob-school-name">School name</FieldLabel>
          <input
            id="ob-school-name"
            className="pg-book-form-input"
            value={field.state.value}
            autoComplete="organization"
            placeholder="e.g. Green Valley Public School"
            aria-invalid={field.state.meta.errors.length > 0 || undefined}
            aria-describedby="ob-school-name-error"
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
          />
          <FieldError id="ob-school-name-error" message={firstError(field.state.meta.errors)} />
        </div>
      )}
    </form.Field>
  );
}

/** The picked logo's preview, with ways to change or remove it. */
function LogoPreview({ logo, onRemove }: { logo: PickedLogo; onRemove: () => void }) {
  return (
    <div className="ob-logo">
      <img src={logo.previewUrl} alt="School logo preview" />
      <span className="ob-logo-meta">
        <b>{logo.file.name}</b>
        <small>{fileSize(logo.file.size)}</small>
      </span>
      <label htmlFor="ob-logo" className="cp-btn cp-btn-light cp-btn-sm">
        Change
      </label>
      <button type="button" className="ob-icon-btn" aria-label="Remove logo" onClick={onRemove}>
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

function LogoDrop() {
  return (
    <label htmlFor="ob-logo" className="ob-drop">
      <ImageUp aria-hidden="true" />
      <span>
        <b>Upload your logo</b>
        <small>PNG, JPG or WebP, up to {MAX_LOGO_BYTES / 1024 / 1024} MB</small>
      </span>
    </label>
  );
}

/**
 * The optional logo. A picked file gets an object URL for its preview, which
 * is revoked when the file is replaced or removed. A file the server would
 * refuse shows why at once, and blocks Continue.
 */
function LogoField({ form }: { form: OnboardingFormApi }) {
  return (
    <form.Field name="logo">
      {(field) => {
        const logo = field.state.value;
        const replace = (next: PickedLogo | null) => {
          if (logo) URL.revokeObjectURL(logo.previewUrl);
          field.handleChange(next);
        };
        return (
          <div className="pg-book-form-field">
            <FieldLabel optional>School logo</FieldLabel>
            <input
              id="ob-logo"
              className="ob-visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-describedby="ob-logo-error"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) replace({ file, previewUrl: URL.createObjectURL(file) });
              }}
            />
            {logo ? <LogoPreview logo={logo} onRemove={() => replace(null)} /> : <LogoDrop />}
            <FieldError id="ob-logo-error" message={firstError(field.state.meta.errors) ?? logoProblem(logo)} />
          </div>
        );
      }}
    </form.Field>
  );
}

function AddressField({ form }: { form: OnboardingFormApi }) {
  return (
    <form.Field name="address">
      {(field) => (
        <div className="pg-book-form-field">
          <FieldLabel htmlFor="ob-address">School address</FieldLabel>
          <textarea
            id="ob-address"
            className="pg-book-form-input ob-textarea"
            rows={3}
            value={field.state.value}
            autoComplete="street-address"
            placeholder="Building, street, area, city, PIN code"
            aria-invalid={field.state.meta.errors.length > 0 || undefined}
            aria-describedby="ob-address-error"
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
          />
          <FieldError id="ob-address-error" message={firstError(field.state.meta.errors)} />
        </div>
      )}
    </form.Field>
  );
}

export function SchoolStep({ form }: { form: OnboardingFormApi }) {
  return (
    <>
      <SchoolNameField form={form} />
      <LogoField form={form} />
      <AddressField form={form} />
    </>
  );
}

import { MAX_NOTES_LENGTH } from "@campuspilot/api/leads/school-onboarding";

import { FieldError, FieldLabel, firstError } from "./field-parts";
import type { OnboardingFormApi } from "./onboarding-form";
import { VoiceNoteField } from "./voice-note-field";

function NotesField({ form }: { form: OnboardingFormApi }) {
  return (
    <form.Field name="notes">
      {(field) => (
        <div className="pg-book-form-field">
          <FieldLabel htmlFor="ob-notes" optional>
            Notes
          </FieldLabel>
          <textarea
            id="ob-notes"
            className="pg-book-form-input ob-textarea"
            rows={5}
            maxLength={MAX_NOTES_LENGTH}
            placeholder="Fee structure, session start date, number of teachers, anything you want us to set up…"
            value={field.state.value}
            aria-invalid={field.state.meta.errors.length > 0 || undefined}
            aria-describedby="ob-notes-error"
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
          />
          <FieldError id="ob-notes-error" message={firstError(field.state.meta.errors)} />
        </div>
      )}
    </form.Field>
  );
}

export function NotesStep({ form }: { form: OnboardingFormApi }) {
  return (
    <>
      <NotesField form={form} />
      <div className="ob-or" aria-hidden="true">
        <span>or</span>
      </div>
      <VoiceNoteField form={form} />
    </>
  );
}

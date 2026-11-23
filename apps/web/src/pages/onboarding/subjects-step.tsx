import { FieldError, firstError } from "./field-parts";
import type { OnboardingFormApi } from "./onboarding-form";
import { PerClassPicker } from "./per-class-picker";

export function SubjectsStep({ form }: { form: OnboardingFormApi }) {
  return (
    <form.Field name="classes">
      {(field) => (
        <fieldset className="pg-book-form-field">
          <legend className="ob-visually-hidden">Subjects of each class</legend>
          <PerClassPicker classes={field.state.value} kind="subjects" onChange={field.handleChange} />
          <FieldError id="ob-subjects-error" message={firstError(field.state.meta.errors)} />
        </fieldset>
      )}
    </form.Field>
  );
}

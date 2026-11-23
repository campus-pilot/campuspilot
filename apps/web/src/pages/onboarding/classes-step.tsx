import { DEFAULT_CLASS_NAMES } from "@campuspilot/api/leads/school-onboarding";

import { ChipPicker, offeredNames } from "./chip-picker";
import { FieldError, firstError } from "./field-parts";
import type { OnboardingFormApi } from "./onboarding-form";
import { orderClasses, sameName, type ClassDraft } from "./onboarding-model";
import { PerClassPicker } from "./per-class-picker";

/** The chosen class names as class drafts: kept classes keep their sections and subjects, new ones start empty. */
function withClassNames(classes: ClassDraft[], names: string[]) {
  return orderClasses(names.map((name) => classes.find((schoolClass) => sameName(schoolClass.name, name)) ?? { name, sections: [], subjects: [] }));
}

/**
 * Classes first, then the sections of each chosen class right below them,
 * so a school picks both on one screen.
 */
export function ClassesStep({ form }: { form: OnboardingFormApi }) {
  return (
    <form.Field name="classes">
      {(field) => {
        const classes = field.state.value;
        return (
          <>
            <fieldset className="pg-book-form-field">
              <legend className="pg-book-form-label">Classes</legend>
              <ChipPicker
                label="Classes"
                options={offeredNames(
                  DEFAULT_CLASS_NAMES,
                  classes.map((schoolClass) => schoolClass.name),
                )}
                selected={classes.map((schoolClass) => schoolClass.name)}
                addPlaceholder="Add class"
                onChange={(names) => field.handleChange(withClassNames(classes, names))}
              />
            </fieldset>
            {classes.length > 0 ? (
              <fieldset className="pg-book-form-field">
                <legend className="pg-book-form-label">Sections of each class</legend>
                <PerClassPicker classes={classes} kind="sections" onChange={field.handleChange} />
              </fieldset>
            ) : null}
            <FieldError id="ob-classes-error" message={firstError(field.state.meta.errors)} />
          </>
        );
      }}
    </form.Field>
  );
}

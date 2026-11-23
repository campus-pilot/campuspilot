import { DEFAULT_SECTION_NAMES, DEFAULT_SUBJECT_NAMES } from "@campuspilot/api/leads/school-onboarding";
import { CopyCheck } from "lucide-react";

import { ChipPicker, offeredNames } from "./chip-picker";
import type { ClassDraft } from "./onboarding-model";

/** What a per-class picker edits: each class's sections, or each class's subjects. */
export type PerClassKind = "sections" | "subjects";

const KIND_TEXT: Record<PerClassKind, { defaults: readonly string[]; add: string; noun: string }> = {
  sections: { defaults: DEFAULT_SECTION_NAMES, add: "Add section", noun: "sections" },
  subjects: { defaults: DEFAULT_SUBJECT_NAMES, add: "Add subject", noun: "subjects" },
};

function ClassRowHead({ schoolClass, kind, canCopy, onCopy }: { schoolClass: ClassDraft; kind: PerClassKind; canCopy: boolean; onCopy: () => void }) {
  const count = schoolClass[kind].length;
  return (
    <div className="ob-class-head">
      <b>{schoolClass.name}</b>
      <small>{count === 0 ? `No ${KIND_TEXT[kind].noun} yet` : `${count} selected`}</small>
      {canCopy ? (
        <button type="button" className="ob-text-btn" onClick={onCopy}>
          <CopyCheck aria-hidden="true" /> Use for all classes
        </button>
      ) : null}
    </div>
  );
}

/**
 * One row per chosen class, each with its own chips for `kind`. Names typed
 * for one class are offered for every class. "Use for all classes" copies a
 * row's choice to every other class, for schools that run the same sections
 * or subjects throughout.
 */
export function PerClassPicker({ classes, kind, onChange }: { classes: ClassDraft[]; kind: PerClassKind; onChange: (next: ClassDraft[]) => void }) {
  const options = offeredNames(
    KIND_TEXT[kind].defaults,
    classes.flatMap((schoolClass) => schoolClass[kind]),
  );
  const update = (name: string, values: string[]) =>
    onChange(classes.map((schoolClass) => (schoolClass.name === name ? { ...schoolClass, [kind]: values } : schoolClass)));
  const copyToAll = (values: string[]) => onChange(classes.map((schoolClass) => ({ ...schoolClass, [kind]: [...values] })));
  return (
    <ul className="ob-class-list">
      {classes.map((schoolClass) => (
        <li key={schoolClass.name} className="ob-class-row">
          <ClassRowHead
            schoolClass={schoolClass}
            kind={kind}
            canCopy={classes.length > 1 && schoolClass[kind].length > 0}
            onCopy={() => copyToAll(schoolClass[kind])}
          />
          <ChipPicker
            label={`${KIND_TEXT[kind].noun} of ${schoolClass.name}`}
            options={options}
            selected={schoolClass[kind]}
            addPlaceholder={KIND_TEXT[kind].add}
            onChange={(values) => update(schoolClass.name, values)}
          />
        </li>
      ))}
    </ul>
  );
}

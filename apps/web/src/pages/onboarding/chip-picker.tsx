import { MAX_NAME_LENGTH } from "@campuspilot/api/leads/school-onboarding";
import { useForm } from "@tanstack/react-form";
import { Check, Plus } from "lucide-react";
import { z } from "zod";

import { customNameSchema, sameName } from "./onboarding-model";

function Chip({ label, selected, onToggle }: { label: string; selected: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="ob-chip" aria-pressed={selected} onClick={onToggle}>
      {selected ? <Check aria-hidden="true" /> : null}
      {label}
    </button>
  );
}

/**
 * Typing a name that is not offered yet. A name that matches an offered one
 * (ignoring case) selects that one instead of adding a near-duplicate. It is
 * a small form of its own, submitted with Enter or the Add button; it never
 * submits the page's form.
 */
function AddChip({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => void }) {
  const form = useForm({
    defaultValues: { name: "" },
    validators: { onSubmit: z.object({ name: customNameSchema }) },
    onSubmit: ({ value }) => {
      onAdd(customNameSchema.parse(value.name));
      form.reset();
    },
  });
  return (
    <form.Field name="name">
      {(field) => (
        <span className="ob-chip-add" data-invalid={field.state.meta.errors.length > 0 || undefined}>
          <input
            aria-label={placeholder}
            placeholder={placeholder}
            value={field.state.value}
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => field.handleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void form.handleSubmit();
            }}
          />
          <button type="button" aria-label={`${placeholder}: add`} onClick={() => void form.handleSubmit()}>
            <Plus aria-hidden="true" />
          </button>
        </span>
      )}
    </form.Field>
  );
}

/**
 * A multi-select of ready-made names shown as chips, plus a box to add any
 * other. `options` is every name to offer (ready-made and already added, in
 * display order); `selected` keeps that order too.
 */
export function ChipPicker({
  label,
  options,
  selected,
  addPlaceholder,
  onChange,
}: {
  label: string;
  options: readonly string[];
  selected: readonly string[];
  addPlaceholder: string;
  onChange: (next: string[]) => void;
}) {
  const isSelected = (name: string) => selected.some((candidate) => sameName(candidate, name));
  /** Offered names in their display order, then names not offered yet (one just typed). */
  const inDisplayOrder = (names: string[]) => [
    ...options.filter((option) => names.some((name) => sameName(name, option))),
    ...names.filter((name) => !options.some((option) => sameName(option, name))),
  ];
  const toggle = (name: string) =>
    onChange(inDisplayOrder(isSelected(name) ? selected.filter((candidate) => !sameName(candidate, name)) : [...selected, name]));
  const add = (name: string) => {
    const offered = options.find((option) => sameName(option, name));
    if (offered && isSelected(offered)) return;
    toggle(offered ?? name);
  };
  return (
    <div className="ob-chips" role="group" aria-label={label}>
      {options.map((option) => (
        <Chip key={option} label={option} selected={isSelected(option)} onToggle={() => toggle(option)} />
      ))}
      <AddChip placeholder={addPlaceholder} onAdd={add} />
    </div>
  );
}

/** Ready-made names followed by every other name already in use, once each, in first-use order. */
export function offeredNames(defaults: readonly string[], inUse: readonly string[]) {
  const names = [...defaults];
  for (const name of inUse) if (!names.some((candidate) => sameName(candidate, name))) names.push(name);
  return names;
}

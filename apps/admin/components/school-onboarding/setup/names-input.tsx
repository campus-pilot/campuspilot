'use client';

import { useForm } from '@tanstack/react-form';
import { Plus, X } from 'lucide-react';
import { z } from 'zod';
import { SCHOOL_SETUP_NAME_MAX_LENGTH } from '@campuspilot/api/school-setup/school-setup.contract';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';

const nameSchema = z.string().trim().min(1).max(SCHOOL_SETUP_NAME_MAX_LENGTH);
const same = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();

function NameChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1 pr-1">
      {name}
      <button type="button" className="rounded-sm p-0.5 hover:bg-muted-foreground/20" aria-label={`Remove ${name}`} onClick={onRemove}>
        <X className="size-3" aria-hidden />
      </button>
    </Badge>
  );
}

/** A small form of its own for typing one more name; Enter or the button adds it. */
function AddName({ label, onAdd }: { label: string; onAdd: (name: string) => void }) {
  const form = useForm({
    defaultValues: { name: '' },
    validators: { onSubmit: z.object({ name: nameSchema }) },
    onSubmit: ({ value }) => {
      onAdd(value.name.trim().replace(/\s+/g, ' '));
      form.reset();
    },
  });
  return (
    <form.Field name="name">
      {(field) => (
        <div className="flex items-center gap-1">
          <Input
            aria-label={label}
            placeholder={label}
            className="w-36"
            maxLength={SCHOOL_SETUP_NAME_MAX_LENGTH}
            value={field.state.value}
            onChange={(event) => field.handleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              void form.handleSubmit();
            }}
          />
          <Button type="button" size="icon-sm" variant="ghost" aria-label={label} onClick={() => void form.handleSubmit()}>
            <Plus aria-hidden />
          </Button>
        </div>
      )}
    </form.Field>
  );
}

/**
 * An editable list of names (sections, subjects): the chosen ones as
 * removable chips, ready-made `suggestions` not chosen yet as one-tap
 * additions, and a box for any other name. A name matching a chosen one,
 * ignoring case, is not added twice.
 */
export function NamesInput({
  label,
  value,
  suggestions = [],
  onChange,
}: {
  label: string;
  value: string[];
  suggestions?: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const add = (name: string) => {
    if (!value.some((existing) => same(existing, name))) onChange([...value, name]);
  };
  const missing = suggestions.filter((suggestion) => !value.some((existing) => same(existing, suggestion)));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((name) => (
        <NameChip key={name} name={name} onRemove={() => onChange(value.filter((existing) => existing !== name))} />
      ))}
      {missing.map((name) => (
        <Button key={name} type="button" size="xs" variant="outline" className="border-dashed text-muted-foreground" onClick={() => add(name)}>
          <Plus aria-hidden /> {name}
        </Button>
      ))}
      <AddName label={`Add ${label}`} onAdd={add} />
    </div>
  );
}

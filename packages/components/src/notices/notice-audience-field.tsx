'use client';

import { useId, type ReactNode } from 'react';
import { Label } from '@campuspilot/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@campuspilot/ui/components/radio-group';

import {
  NOTICE_AUDIENCE_CHOICES,
  NOTICE_AUDIENCE_OPTIONS,
  NOTICE_CADET_CLASS_SCOPES,
  NOTICE_CADET_CLASS_SCOPE_OPTIONS,
  type NoticeAudienceChoice,
  type NoticeCadetClassScope,
} from './notice-audience';

type Option<T extends string> = { value: T; label: string; description: string };

function OptionRow<T extends string>({ id, option }: { id: string; option: Option<T> }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border p-3 has-data-checked:border-primary/50 has-data-checked:bg-primary/[0.04]">
      <RadioGroupItem id={id} value={option.value} className="mt-0.5" />
      <Label htmlFor={id} className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <span className="font-medium">{option.label}</span>
        <span className="text-xs font-normal text-muted-foreground">{option.description}</span>
      </Label>
    </div>
  );
}

function OptionRadioGroup<T extends string>({ legend, value, options, className, onChange, children }: { legend: string; value: T; options: readonly Option<T>[]; className: string; onChange: (value: T) => void; children?: ReactNode }) {
  const id = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <RadioGroup value={value} className={className} onValueChange={(next) => onChange(next as T)}>
        {options.map((option) => <OptionRow key={option.value} id={`${id}-${option.value}`} option={option} />)}
      </RadioGroup>
      {children}
    </fieldset>
  );
}

/**
 * "Who is this notice for?" as the three readable choices. Without the
 * Cadet Portal only "Staff" can be chosen, so the student choices are not
 * rendered at all (`cadetsAvailable`). `children` holds the field's errors
 * or a note.
 */
export function NoticeAudienceField({ value, cadetsAvailable, onChange, children }: { value: NoticeAudienceChoice; cadetsAvailable: boolean; onChange: (value: NoticeAudienceChoice) => void; children?: ReactNode }) {
  const choices = cadetsAvailable ? NOTICE_AUDIENCE_CHOICES : (['staff'] as const);
  return (
    <OptionRadioGroup
      legend="Who is this notice for?"
      value={value}
      className={cadetsAvailable ? 'grid gap-2 sm:grid-cols-3' : 'grid gap-2'}
      options={choices.map((choice) => ({ value: choice, ...NOTICE_AUDIENCE_OPTIONS[choice] }))}
      onChange={onChange}
    >
      {children}
    </OptionRadioGroup>
  );
}

/** "Which classes?", shown once students are included. `children` holds the class picker and errors. */
export function NoticeCadetClassScopeField({ value, onChange, children }: { value: NoticeCadetClassScope; onChange: (value: NoticeCadetClassScope) => void; children?: ReactNode }) {
  return (
    <OptionRadioGroup
      legend="Which cadets?"
      value={value}
      className="grid gap-2 sm:grid-cols-2"
      options={NOTICE_CADET_CLASS_SCOPES.map((scope) => ({ value: scope, ...NOTICE_CADET_CLASS_SCOPE_OPTIONS[scope] }))}
      onChange={onChange}
    >
      {children}
    </OptionRadioGroup>
  );
}

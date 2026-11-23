'use client';

import { CopyCheck, Plus, Trash2 } from 'lucide-react';
import { DEFAULT_SECTION_NAMES, DEFAULT_SUBJECT_NAMES } from '@campuspilot/api/leads/school-onboarding';
import { SCHOOL_SETUP_MAX_CLASSES, type SchoolSetupDraft } from '@campuspilot/api/school-setup/school-setup.contract';
import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';
import { FieldError, StepIntro } from './field-bits';
import { NamesInput } from './names-input';
import type { SetupFormApi } from './setup-form';

type ClassDraft = SchoolSetupDraft['classes'][number];

function ClassHead({ name, index, onRename, onRemove, onCopy }: { name: string; index: number; onRename: (name: string) => void; onRemove: () => void; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <Input aria-label={`Class ${index + 1} name`} value={name} className="sm:max-w-56" onChange={(event) => onRename(event.target.value)} />
      <Button type="button" variant="ghost" onClick={onCopy}>
        <CopyCheck aria-hidden /> Use for all classes
      </Button>
      <Button type="button" variant="ghost" size="icon" className="ml-auto" aria-label={`Remove ${name || 'class'}`} onClick={onRemove}>
        <Trash2 aria-hidden />
      </Button>
    </div>
  );
}

/** One class: its name, sections and subjects, each editable. */
function ClassCard({ entry, index, onChange, onRemove, onCopy }: { entry: ClassDraft; index: number; onChange: (next: ClassDraft) => void; onRemove: () => void; onCopy: () => void }) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border p-3">
      <ClassHead name={entry.name} index={index} onRename={(name) => onChange({ ...entry, name })} onRemove={onRemove} onCopy={onCopy} />
      <div className="grid gap-1.5 sm:grid-cols-[5rem_1fr] sm:items-start">
        <span className="pt-1 text-xs text-muted-foreground">Sections</span>
        <NamesInput label="section" value={entry.sections} suggestions={DEFAULT_SECTION_NAMES} onChange={(sections) => onChange({ ...entry, sections })} />
        <span className="pt-1 text-xs text-muted-foreground">Subjects</span>
        <NamesInput label="subject" value={entry.subjects} suggestions={DEFAULT_SUBJECT_NAMES} onChange={(subjects) => onChange({ ...entry, subjects })} />
      </div>
    </li>
  );
}

/**
 * The classes to create, started from the form's answers. Each keeps its
 * own sections and subjects; "Use for all classes" copies one class's
 * sections and subjects to every class.
 */
export function ClassesStep({ form }: { form: SetupFormApi }) {
  return (
    <form.Field name="draft.classes">
      {(field) => {
        const classes = field.state.value;
        const replace = (index: number, next: ClassDraft) => field.handleChange(classes.map((entry, position) => (position === index ? next : entry)));
        return (
          <div className="flex flex-col gap-4">
            <StepIntro title="Classes" description="Every class with its sections and subjects. Each subject gets one written paper per examination; splits are set later." />
            <ul className="flex flex-col gap-3">
              {classes.map((entry, index) => (
                <ClassCard
                  key={index}
                  entry={entry}
                  index={index}
                  onChange={(next) => replace(index, next)}
                  onRemove={() => field.handleChange(classes.filter((_, position) => position !== index))}
                  onCopy={() => field.handleChange(classes.map((other) => ({ ...other, sections: [...entry.sections], subjects: [...entry.subjects] })))}
                />
              ))}
            </ul>
            {classes.length < SCHOOL_SETUP_MAX_CLASSES ? (
              <Button type="button" variant="outline" className="self-start" onClick={() => field.handleChange([...classes, { name: '', sections: ['A'], subjects: [] }])}>
                <Plus aria-hidden /> Add class
              </Button>
            ) : null}
            <FieldError errors={field.state.meta.errors} />
          </div>
        );
      }}
    </form.Field>
  );
}

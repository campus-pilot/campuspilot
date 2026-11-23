'use client';

import { Plus, X } from 'lucide-react';
import { ONBOARDING_MAX_EXAMS } from '@campuspilot/api/school-onboarding/school-onboarding.contract';
import { OptionSelect } from '@campuspilot/components/option-select';
import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';
import { FieldError, FieldRow, StepIntro } from './field-bits';
import type { SetupFormApi } from './setup-form';

/** `2026–27`. */
function sessionLabel(startYear: number) {
  return `${startYear}–${String(startYear + 1).slice(-2)}`;
}

function StartYearField({ form }: { form: SetupFormApi }) {
  const thisYear = new Date().getFullYear();
  const years = [thisYear - 1, thisYear, thisYear + 1];
  return (
    <form.Field name="draft.session.startYear">
      {(field) => (
        <FieldRow id={field.name} label="Academic session" hint="April to March. It becomes the school's active session.">
          <OptionSelect
            value={String(field.state.value)}
            options={years.map((year) => ({ value: String(year), label: sessionLabel(year) }))}
            onValueChange={(year) => field.handleChange(Number(year))}
            triggerProps={{ id: field.name, className: 'w-full sm:w-48' }}
          />
        </FieldRow>
      )}
    </form.Field>
  );
}

function ExamNamesField({ form }: { form: SetupFormApi }) {
  return (
    <form.Field name="draft.session.examNames">
      {(field) => (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Examinations</span>
          <ol className="flex flex-col gap-2">
            {field.state.value.map((name, index) => (
              <li key={index} className="flex items-center gap-2">
                <span className="w-5 text-right text-xs text-muted-foreground">{index + 1}</span>
                <Input
                  aria-label={`Examination ${index + 1}`}
                  value={name}
                  onChange={(event) => field.handleChange(field.state.value.map((existing, position) => (position === index ? event.target.value : existing)))}
                />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove examination ${index + 1}`} onClick={() => field.handleChange(field.state.value.filter((_, position) => position !== index))}>
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
          {field.state.value.length < ONBOARDING_MAX_EXAMS ? (
            <Button type="button" variant="outline" className="self-start" onClick={() => field.handleChange([...field.state.value, ''])}>
              <Plus aria-hidden /> Add examination
            </Button>
          ) : null}
          <FieldError errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}

export function SessionStep({ form }: { form: SetupFormApi }) {
  return (
    <div className="flex flex-col gap-5">
      <StepIntro title="Session" description="The first academic session and its examinations, in order. Every class gets a plan for each examination." />
      <StartYearField form={form} />
      <ExamNamesField form={form} />
    </div>
  );
}

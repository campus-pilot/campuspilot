'use client';

import type { ReactNode } from 'react';
import { ONBOARDING_CLASSES, ONBOARDING_STAGES, stagesOfClasses, type OnboardingStageKey } from '@campuspilot/api/school-onboarding/school-onboarding.contract';
import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';
import { ChevronLeft, ChevronRight, Minus, Plus, X } from 'lucide-react';
import { FormErrors } from '@/components/form-errors';
import type { OnboardingForm } from './onboarding-form';
import { canAddExam, examNameAt, sessionLabel, stageClassRange, subjectPaperCount } from './onboarding-model';

/** A screen's question and the line under it. */
export function StepHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/** A round − / + or ‹ / › button beside a value the person steps through. */
function StepperButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" variant="outline" size="icon-lg" className="rounded-full" aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}

/** The academic session, filled in from today's date; the arrows move it a year. */
export function SessionStep({ form }: { form: OnboardingForm }) {
  return (
    <>
      <StepHeading title="Your academic session">
        We&apos;ve filled in the current year. Change it if your school runs a different session.
      </StepHeading>
      <form.Field name="sessionStartYear">
        {(field) => (
          <div className="flex items-center justify-center gap-6 py-4">
            <StepperButton label="Previous year" onClick={() => field.handleChange(field.state.value - 1)}>
              <ChevronLeft aria-hidden />
            </StepperButton>
            <div className="flex flex-col items-center gap-1">
              <output className="text-3xl font-semibold tabular-nums tracking-tight">{sessionLabel(field.state.value)}</output>
              <span className="text-sm text-muted-foreground">
                April {field.state.value} to March {field.state.value + 1}
              </span>
            </div>
            <StepperButton label="Next year" onClick={() => field.handleChange(field.state.value + 1)}>
              <ChevronRight aria-hidden />
            </StepperButton>
          </div>
        )}
      </form.Field>
    </>
  );
}

/** One examination's name, with its error beside it. */
function ExamNameField({ form, index }: { form: OnboardingForm; index: number }) {
  return (
    <form.Field name={`examNames[${index}]`}>
      {(field) => (
        <div className="flex items-start gap-2">
          <span className="w-5 pt-1.5 text-right text-xs text-muted-foreground tabular-nums">{index + 1}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Input
              aria-label={`Examination ${index + 1} name`}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
            />
            <FormErrors errors={field.state.meta.errors} />
          </div>
        </div>
      )}
    </form.Field>
  );
}

/** How many examinations, and their names: four by default, each renamable. */
export function ExamsStep({ form }: { form: OnboardingForm }) {
  return (
    <>
      <StepHeading title="How many examinations this year?">Rename any of them. You can add or remove examinations later.</StepHeading>
      <form.Field name="examNames" mode="array">
        {(field) => (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-center gap-6">
              <StepperButton label="One examination fewer" disabled={field.state.value.length <= 1} onClick={() => field.removeValue(field.state.value.length - 1)}>
                <Minus aria-hidden />
              </StepperButton>
              <output aria-label="Number of examinations" className="w-10 text-center text-3xl font-semibold tabular-nums">
                {field.state.value.length}
              </output>
              <StepperButton label="One examination more" disabled={!canAddExam(field.state.value.length)} onClick={() => field.pushValue(examNameAt(field.state.value.length))}>
                <Plus aria-hidden />
              </StepperButton>
            </div>
            <div className="flex flex-col gap-2">
              {field.state.value.map((_, index) => (
                <ExamNameField key={index} form={form} index={index} />
              ))}
            </div>
          </div>
        )}
      </form.Field>
    </>
  );
}

/** A class the person can tick or untick. */
function ClassChip({ label, pressed, onToggle }: { label: string; pressed: boolean; onToggle: () => void }) {
  return (
    <Button type="button" variant={pressed ? 'secondary' : 'outline'} aria-pressed={pressed} onClick={onToggle} className={pressed ? 'border-primary/40 bg-primary/10' : 'text-muted-foreground'}>
      {pressed ? <span aria-hidden className="text-primary">✓</span> : <Plus aria-hidden />}
      {label}
    </Button>
  );
}

/** Which classes the school runs: Nursery to Class 10 ticked, Class 11 and 12 a tap away. */
export function ClassesStep({ form }: { form: OnboardingForm }) {
  return (
    <>
      <StepHeading title="Which classes does your school have?">Tap a class to remove it, or to add it back.</StepHeading>
      <form.Field name="classSlugs">
        {(field) => {
          const chosen = new Set(field.state.value);
          const toggle = (slug: string) =>
            field.handleChange(chosen.has(slug) ? field.state.value.filter((entry) => entry !== slug) : [...field.state.value, slug]);
          return (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground">{chosen.size}</span> selected
                </span>
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => field.handleChange(ONBOARDING_CLASSES.map((entry) => entry.slug))}>Select all</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => field.handleChange([])}>Clear</Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {ONBOARDING_CLASSES.map((entry) => (
                  <ClassChip key={entry.slug} label={entry.label} pressed={chosen.has(entry.slug)} onToggle={() => toggle(entry.slug)} />
                ))}
              </div>
              <FormErrors errors={field.state.meta.errors} />
            </div>
          );
        }}
      </form.Field>
    </>
  );
}

/** A subject in a stage's list, with its remove button. */
function SubjectChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 pl-3 pr-1 text-sm">
      {name}
      <Button type="button" variant="ghost" size="icon-xs" className="rounded-full" aria-label={`Remove ${name}`} onClick={onRemove}>
        <X aria-hidden />
      </Button>
    </span>
  );
}

/** The box that adds a subject to a stage: Enter or Add puts it in the list and empties the box. */
function AddSubject({ form, stage }: { form: OnboardingForm; stage: OnboardingStageKey }) {
  const add = () => {
    const name = form.getFieldValue(`newSubject.${stage}`).trim();
    if (!name) return;
    form.pushFieldValue(`subjects.${stage}`, name);
    form.setFieldValue(`newSubject.${stage}`, '');
  };
  return (
    <form.Field name={`newSubject.${stage}`}>
      {(field) => (
        <div className="flex gap-2">
          <Input
            aria-label={`Add a subject to ${ONBOARDING_STAGES.find((entry) => entry.key === stage)!.label}`}
            placeholder="Add a subject"
            value={field.state.value}
            onChange={(event) => field.handleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              add();
            }}
          />
          <Button type="button" variant="outline" onClick={add}>
            Add
          </Button>
        </div>
      )}
    </form.Field>
  );
}

/** One stage's subjects: its classes, its list and the box to add one. */
function StageSubjects({ form, stage, classSlugs }: { form: OnboardingForm; stage: OnboardingStageKey; classSlugs: string[] }) {
  const label = ONBOARDING_STAGES.find((entry) => entry.key === stage)!.label;
  return (
    <section aria-label={`${label} subjects`} className="flex flex-col gap-3 rounded-lg border p-3">
      <h2 className="flex items-baseline justify-between gap-2 text-sm font-medium">
        {label}
        <span className="text-xs font-normal text-muted-foreground">{stageClassRange(stage, classSlugs)}</span>
      </h2>
      <form.Field name={`subjects.${stage}`} mode="array">
        {(field) => (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {field.state.value.map((name, index) => (
                <SubjectChip key={`${name}-${index}`} name={name} onRemove={() => field.removeValue(index)} />
              ))}
            </div>
            <FormErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <AddSubject form={form} stage={stage} />
    </section>
  );
}

/** Each stage's starter subjects, only for stages with a chosen class. */
export function SubjectsStep({ form }: { form: OnboardingForm }) {
  return (
    <>
      <StepHeading title="Subjects you teach">
        A starter list for each stage. Remove what you don&apos;t teach. Each subject is one written paper of 100 marks.
      </StepHeading>
      <form.Subscribe selector={(state) => ({ classSlugs: state.values.classSlugs, subjects: state.values.subjects })}>
        {(values) => (
          <div className="flex flex-col gap-3">
            {stagesOfClasses(values.classSlugs).map((stage) => (
              <StageSubjects key={stage} form={form} stage={stage} classSlugs={values.classSlugs} />
            ))}
            <p className="text-xs text-muted-foreground">
              {subjectPaperCount(values)} subject papers in each examination.
            </p>
          </div>
        )}
      </form.Subscribe>
    </>
  );
}

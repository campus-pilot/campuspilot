'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, Circle } from 'lucide-react';
import { SCHOOL_SETUP_WIZARD_STEPS, type SchoolSetupWizardStep } from '@campuspilot/api/school-setup/school-setup.contract';
import { OptionSelect } from '@campuspilot/components/option-select';
import { Button } from '@campuspilot/ui/components/button';
import { ClassesStep } from './classes-step';
import { FeaturesStep } from './features-step';
import { PeopleStep } from './people-step';
import { PlanStep } from './plan-step';
import { ReviewDialog } from './review-dialog';
import { SchoolStep } from './school-step';
import { SessionStep } from './session-step';
import { stepsNeedingAttention, useSetupForm, type SetupFormValues, type SetupWizard } from './setup-form';

const timeFormatter = new Intl.DateTimeFormat('en-IN', { timeStyle: 'short' });
const stepIndex = (step: SchoolSetupWizardStep) => SCHOOL_SETUP_WIZARD_STEPS.findIndex((entry) => entry.id === step);

/** Left navigation on wide screens, a step select on phones; a dot marks a step that needs attention. */
function StepNavigation({ wizard }: { wizard: SetupWizard }) {
  const { form } = wizard;
  return (
    <form.Subscribe selector={(state) => ({ step: state.values.step, attention: state.submissionAttempts > 0 ? stepsNeedingAttention(state.values.draft) : new Set<string>() })}>
      {({ step, attention }) => (
        <>
          <nav aria-label="Setup steps" className="hidden flex-col gap-1 md:flex">
            {SCHOOL_SETUP_WIZARD_STEPS.map((entry, index) => (
              <Button key={entry.id} type="button" variant={entry.id === step ? 'secondary' : 'ghost'} className="justify-start" onClick={() => wizard.goTo(entry.id)}>
                <span className="w-4 text-xs text-muted-foreground">{index + 1}</span>
                {entry.label}
                {attention.has(entry.id) ? <Circle className="ml-auto size-2 fill-destructive text-destructive" aria-label="Needs attention" /> : null}
              </Button>
            ))}
          </nav>
          <div className="md:hidden">
            <OptionSelect
              value={step}
              options={SCHOOL_SETUP_WIZARD_STEPS.map((entry, index) => ({ value: entry.id, label: `${index + 1}. ${entry.label}${attention.has(entry.id) ? ' (needs attention)' : ''}` }))}
              onValueChange={wizard.goTo}
              triggerProps={{ className: 'w-full', 'aria-label': 'Setup step' }}
            />
          </div>
        </>
      )}
    </form.Subscribe>
  );
}

function CurrentStep({ wizard, step, requestId, hasLogo }: { wizard: SetupWizard; step: SchoolSetupWizardStep; requestId: string; hasLogo: boolean }) {
  const { form } = wizard;
  if (step === 'school') return <SchoolStep form={form} requestId={requestId} hasLogo={hasLogo} />;
  if (step === 'plan') return <PlanStep form={form} />;
  if (step === 'features') return <FeaturesStep form={form} />;
  if (step === 'session') return <SessionStep form={form} />;
  if (step === 'classes') return <ClassesStep form={form} />;
  return <PeopleStep form={form} />;
}

function SaveStatus({ wizard, savedAt }: { wizard: SetupWizard; savedAt: Date | null }) {
  const { save } = wizard;
  if (save.isPending) return <span className="text-xs text-muted-foreground">Saving…</span>;
  if (save.error) return <span className="text-xs text-destructive">Not saved: {save.error.message}</span>;
  const at = save.data?.draftUpdatedAt ?? savedAt;
  return <span className="text-xs text-muted-foreground">{at ? `Draft saved ${timeFormatter.format(at)}` : 'Not saved yet'}</span>;
}

function WizardActions({ wizard, step, savedAt }: { wizard: SetupWizard; step: SchoolSetupWizardStep; savedAt: Date | null }) {
  const index = stepIndex(step);
  const last = index === SCHOOL_SETUP_WIZARD_STEPS.length - 1;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-4">
      {index > 0 ? (
        <Button type="button" variant="outline" onClick={() => wizard.goTo(SCHOOL_SETUP_WIZARD_STEPS[index - 1]!.id)}>
          <ArrowLeft aria-hidden /> Back
        </Button>
      ) : null}
      <SaveStatus wizard={wizard} savedAt={savedAt} />
      <div className="ml-auto flex gap-2">
        <Button type="button" variant="outline" disabled={wizard.save.isPending} onClick={() => wizard.save.mutate(wizard.form.state.values)}>
          Save draft
        </Button>
        {last ? (
          <Button type="button" onClick={() => void wizard.form.handleSubmit()}>
            Review and create
          </Button>
        ) : (
          <Button type="button" onClick={() => wizard.goTo(SCHOOL_SETUP_WIZARD_STEPS[index + 1]!.id)}>
            Next <ArrowRight aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The setup wizard: six steps over one form, saved as a draft whenever the
 * step changes (and with Save draft), so the admin can leave and continue
 * later. "Review and create" checks everything, then shows what will be
 * created before the setup is started.
 */
export function SetupWizardForm({
  requestId,
  hasLogo,
  initial,
  savedAt,
  onStarted,
}: {
  requestId: string;
  hasLogo: boolean;
  initial: SetupFormValues;
  savedAt: Date | null;
  onStarted: () => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const wizard = useSetupForm({ requestId, initial, onReady: () => setReviewing(true) });
  const { form, start } = wizard;
  return (
    <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
      <StepNavigation wizard={wizard} />
      <div className="flex min-w-0 flex-col gap-6 rounded-xl border p-5">
        <form.Subscribe selector={(state) => state.values.step}>
          {(step) => (
            <>
              <CurrentStep wizard={wizard} step={step} requestId={requestId} hasLogo={hasLogo} />
              <WizardActions wizard={wizard} step={step} savedAt={savedAt} />
            </>
          )}
        </form.Subscribe>
      </div>
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <ReviewDialog
            draft={values.draft}
            hasLogo={hasLogo}
            open={reviewing}
            creating={start.isPending}
            error={start.error?.message ?? null}
            onCancel={() => setReviewing(false)}
            onConfirm={() => start.mutate(values, { onSuccess: () => { setReviewing(false); onStarted(); } })}
          />
        )}
      </form.Subscribe>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Button } from '@campuspilot/ui/components/button';
import { Progress } from '@campuspilot/ui/components/progress';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { orpc } from '@/lib/orpc';
import { schoolHref } from '../school-route';
import { NewSchoolTrialFacts } from '../school-creation/new-school-welcome';
import { startOnboardingAttempt, useOnboardingForm, type OnboardingForm } from './onboarding-form';
import { HeaderStep } from './onboarding-header-step';
import { ONBOARDING_STEPS, isStepComplete, type OnboardingStep } from './onboarding-model';
import { ClassesStep, ExamsStep, SessionStep, SubjectsStep } from './onboarding-steps';

/** The screen of one step. */
function StepBody({ step, form, schoolId }: { step: OnboardingStep; form: OnboardingForm; schoolId: string }) {
  switch (step) {
    case 'session':
      return (
        <>
          <NewSchoolTrialFacts schoolId={schoolId} />
          <SessionStep form={form} />
        </>
      );
    case 'exams':
      return <ExamsStep form={form} />;
    case 'classes':
      return <ClassesStep form={form} />;
    case 'subjects':
      return <SubjectsStep form={form} />;
    case 'header':
      return <HeaderStep form={form} schoolId={schoolId} />;
  }
}

/** Shown while the guide saves: the one call that sets the school up. */
function SettingUp() {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-16 text-center">
      <Spinner className="size-6 text-primary" />
      <p className="font-medium">Setting up your school…</p>
      <p className="max-w-xs text-sm text-muted-foreground">Creating the session, examinations, classes, subjects and exam plans.</p>
    </div>
  );
}

/** The refusal of the last attempt, kept on screen with the answers so the person can retry. */
function SubmitError({ form }: { form: OnboardingForm }) {
  return (
    <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
      {(error) =>
        error && typeof error === 'object' && 'form' in error ? (
          <p role="alert" className="px-5 text-xs text-destructive">
            {String(error.form)}
          </p>
        ) : null
      }
    </form.Subscribe>
  );
}

/**
 * Set up later: the guide is set aside and the person goes to the school,
 * whose empty screens offer each next step on their own.
 */
function useSkipOnboarding(schoolId: string) {
  const router = useRouter();
  return useMutation({
    ...orpc.school.skipOnboarding.mutationOptions(),
    onSuccess: () => router.push(schoolHref(schoolId)),
  });
}

function WizardFooter({ form, schoolId, stepIndex, onBack }: { form: OnboardingForm; schoolId: string; stepIndex: number; onBack: () => void }) {
  const skip = useSkipOnboarding(schoolId);
  const step = ONBOARDING_STEPS[stepIndex]!;
  const last = stepIndex === ONBOARDING_STEPS.length - 1;
  return (
    <form.Subscribe selector={(state) => ({ values: state.values, isSubmitting: state.isSubmitting })}>
      {({ values, isSubmitting }) => (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
          <Button type="button" variant="ghost" disabled={isSubmitting || skip.isPending} onClick={() => skip.mutate({ schoolId })}>
            Set up later
          </Button>
          <div className="flex gap-2">
            {stepIndex > 0 ? (
              <Button type="button" variant="outline" disabled={isSubmitting} onClick={onBack}>
                Back
              </Button>
            ) : null}
            <Button type="submit" disabled={isSubmitting || !isStepComplete(step, values)}>
              {last ? 'Finish setup' : 'Continue'}
            </Button>
          </div>
          {skip.isError ? <p role="alert" className="w-full text-xs text-destructive">{skip.error.message}</p> : null}
        </div>
      )}
    </form.Subscribe>
  );
}

function WizardProgress({ stepIndex }: { stepIndex: number }) {
  return (
    <div className="flex flex-col gap-2 px-5 pt-4">
      <span className="text-xs text-muted-foreground">
        Step {stepIndex + 1} of {ONBOARDING_STEPS.length}
      </span>
      <Progress value={((stepIndex + 1) / ONBOARDING_STEPS.length) * 100} aria-label="Setup progress" />
    </div>
  );
}

/**
 * The guide's screens, one form across them (docs/school-creation.md,
 * "Guided setup"). The step on screen is navigation, not an answer, so it is
 * the only local state; every answer lives in the form. Continue moves on
 * once the screen's answers pass the server's rule, and the last screen
 * saves everything at once. Enter in a field moves on too.
 */
export function OnboardingWizard({ schoolId }: { schoolId: string }) {
  const form = useOnboardingForm(schoolId);
  const [stepIndex, setStepIndex] = useState(0);
  const step = ONBOARDING_STEPS[stepIndex]!;
  const last = stepIndex === ONBOARDING_STEPS.length - 1;
  return (
    <form
      noValidate
      className="flex w-full max-w-lg flex-col rounded-xl border bg-card shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (last) void startOnboardingAttempt(form);
        else if (isStepComplete(step, form.state.values)) setStepIndex(stepIndex + 1);
      }}
    >
      <WizardProgress stepIndex={stepIndex} />
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) =>
          isSubmitting ? (
            <SettingUp />
          ) : (
            <div className="flex flex-col gap-5 p-5">
              <StepBody step={step} form={form} schoolId={schoolId} />
            </div>
          )
        }
      </form.Subscribe>
      <SubmitError form={form} />
      <WizardFooter form={form} schoolId={schoolId} stepIndex={stepIndex} onBack={() => setStepIndex(stepIndex - 1)} />
    </form>
  );
}

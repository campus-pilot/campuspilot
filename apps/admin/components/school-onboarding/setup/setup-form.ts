'use client';

import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  SCHOOL_SETUP_WIZARD_STEP_IDS,
  schoolSetupReadySchema,
  wizardStepOfIssue,
  type SchoolSetupDraft,
  type SchoolSetupWizardStep,
} from '@campuspilot/api/school-setup/school-setup.contract';
import { client, orpc } from '@/lib/orpc';

/**
 * The wizard's form: the step on screen and the draft. Submitting checks the
 * draft with the same rules the API and the worker apply
 * (`schoolSetupReadySchema`), so every problem shows beside its field before
 * the review dialog opens; a field on another step marks that step instead.
 */
const setupFormSchema = z.object({ step: z.enum(SCHOOL_SETUP_WIZARD_STEP_IDS), draft: schoolSetupReadySchema });

export type SetupFormValues = { step: SchoolSetupWizardStep; draft: SchoolSetupDraft };

export function useSetupForm(options: { requestId: string; initial: SetupFormValues; onReady: () => void }) {
  const queryClient = useQueryClient();
  const queryKey = orpc.systemAdmin.getSchoolSetup.queryKey({ input: { requestId: options.requestId } });
  const save = useMutation({
    mutationFn: (value: SetupFormValues) => client.systemAdmin.saveSchoolSetupDraft({ requestId: options.requestId, draft: value.draft, step: value.step }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listSchoolRegistrationRequests.key() }),
  });
  const start = useMutation({
    mutationFn: (value: SetupFormValues) => client.systemAdmin.startSchoolSetup({ requestId: options.requestId, draft: value.draft, step: value.step }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listSchoolRegistrationRequests.key() });
    },
  });
  const form = useForm({
    defaultValues: options.initial,
    validators: { onSubmit: setupFormSchema },
    onSubmit: () => options.onReady(),
    // Sends the admin to the first step that needs attention.
    onSubmitInvalid: ({ value }) => {
      const issue = schoolSetupReadySchema.safeParse(value.draft).error?.issues[0];
      if (issue) form.setFieldValue('step', wizardStepOfIssue(issue.path));
    },
  });
  /** Moves to a step and saves the draft as it stands, so leaving the page never loses more than the step in view. */
  const goTo = (step: SchoolSetupWizardStep) => {
    form.setFieldValue('step', step);
    save.mutate({ step, draft: form.state.values.draft });
  };
  return { form, save, start, goTo };
}

export type SetupWizard = ReturnType<typeof useSetupForm>;
export type SetupFormApi = SetupWizard['form'];

/** The wizard steps with a problem, from the same rules as the API; shown once a review was attempted. */
export function stepsNeedingAttention(draft: SchoolSetupDraft): Set<SchoolSetupWizardStep> {
  const issues = schoolSetupReadySchema.safeParse(draft).error?.issues ?? [];
  return new Set(issues.map((issue) => wizardStepOfIssue(issue.path)));
}

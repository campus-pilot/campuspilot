'use client';

import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@campuspilot/ui/lib/toast';
import { client } from '@/lib/orpc';
import { prepareSchoolLogo, uploadPreparedSchoolLogo } from '@/lib/school-image';
import { isOnboardingPaperDesign, onboardingDefaults, onboardingFormSchema, onboardingInput, type OnboardingValues } from './onboarding-model';

/**
 * Uploads the logo the person chose for the paper header. The logo is
 * optional and both designs print without one, so a failed upload does not
 * stop the setup: the person is told to add it from Organization settings.
 */
async function uploadOptionalLogo(schoolId: string, logo: File | null) {
  if (!logo) return;
  try {
    await uploadPreparedSchoolLogo(schoolId, await prepareSchoolLogo(logo));
  } catch {
    toast.error('Your logo could not be added. You can add it later from Organization settings.');
  }
}

/**
 * Selects the chosen question paper design through the marketplace's own
 * procedure and its revision check. Nothing changes when it is already the
 * school's (a retried setup selected it the first time). A template the
 * school chose itself, one that is neither of the guide's designs (an edited
 * or another marketplace design, picked after Set up later), is kept: the
 * guide never replaces a header the owner made.
 */
async function selectPaperDesign(schoolId: string, design: OnboardingValues['design']) {
  const scope = { schoolId, documentType: 'question_paper' as const };
  const active = await client.school.getActiveDocumentTemplate(scope);
  if (active?.artifact.marketplaceSlug === design) return;
  if (active && !isOnboardingPaperDesign(active.artifact.marketplaceSlug)) return;
  await client.school.selectMarketplaceTemplate({ ...scope, slug: design, expectedRevisionId: active?.revisionId ?? null });
}

/**
 * The guide's one form, across all of its screens. Finishing uploads the
 * logo, selects the paper design and then sets the school up in one
 * transaction (`school.completeOnboarding`). The design is selected first:
 * it is the one step that writes a file, and selecting it again is harmless,
 * so a setup refused afterwards can simply be retried. Once the setup is
 * saved every cached read is refreshed, and the page, which follows the
 * guide's state, moves on to the first paper.
 */
export function useOnboardingForm(schoolId: string) {
  const queryClient = useQueryClient();
  return useForm({
    defaultValues: onboardingDefaults(new Date()),
    validators: { onChange: onboardingFormSchema, onSubmit: onboardingFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await uploadOptionalLogo(schoolId, value.logo);
        await selectPaperDesign(schoolId, value.design);
        await client.school.completeOnboarding(onboardingInput(schoolId, value));
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: { form: error instanceof Error ? error.message : 'Your school could not be set up. Try again.', fields: {} },
        });
        return;
      }
      await queryClient.invalidateQueries();
    },
  });
}

export type OnboardingForm = ReturnType<typeof useOnboardingForm>;

/**
 * Starts a setup attempt. The previous attempt's refusal is cleared first:
 * TanStack Form keeps a form-level `onSubmit` error set by the handler, so the
 * form would stay invalid and never reach `onSubmit` again (the same reason as
 * `startCreateExamAttempt`).
 */
export function startOnboardingAttempt(form: OnboardingForm) {
  form.setErrorMap({ onSubmit: undefined });
  return form.handleSubmit();
}

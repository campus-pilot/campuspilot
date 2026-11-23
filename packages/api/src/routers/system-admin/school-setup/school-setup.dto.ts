import { entityIdSchema } from '@campuspilot/db/id';
import { schoolSetupStatusEnum } from '@campuspilot/db/schema/school-setup';
import { z } from 'zod';

import { SCHOOL_SETUP_WIZARD_STEP_IDS, schoolSetupDraftSchema } from '../../../school-setup/school-setup.contract';

const requestIdSchema = entityIdSchema('schoolRegistrationRequest');

export const getSchoolSetupInputSchema = z.object({ requestId: requestIdSchema });

/** `{ requestId, draft, step }`: the wizard's answers and the step it is on. */
export const saveSchoolSetupDraftInputSchema = z.object({
  requestId: requestIdSchema,
  draft: schoolSetupDraftSchema,
  step: z.enum(SCHOOL_SETUP_WIZARD_STEP_IDS),
});

export const schoolSetupStatusSchema = z.enum(schoolSetupStatusEnum.enumValues);

/** One setup as the admin app reads it: the saved draft and, once started, the run's progress and outcome. */
export const schoolSetupDtoSchema = z.object({
  id: z.string(),
  status: schoolSetupStatusSchema,
  draft: schoolSetupDraftSchema,
  draftStep: z.enum(SCHOOL_SETUP_WIZARD_STEP_IDS),
  draftUpdatedAt: z.date(),
  attempt: z.number().int(),
  schoolId: z.string().nullable(),
  currentStep: z.string().nullable(),
  completedSteps: z.array(z.string()),
  error: z.object({ step: z.string(), message: z.string() }).nullable(),
  result: z
    .object({
      schoolId: z.string(),
      sessionId: z.string(),
      classCount: z.number().int(),
      examCount: z.number().int(),
      principalUserId: z.string(),
      principalHasPassword: z.boolean(),
    })
    .nullable(),
  /** Why the last hand-over to the workflow engine failed, while it is retried. */
  lastSubmitError: z.string().nullable(),
  submittedAt: z.date().nullable(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
});
export type SchoolSetupDto = z.infer<typeof schoolSetupDtoSchema>;

/**
 * The setup of a request: `setup` when one was saved, and `proposedDraft`,
 * the first draft built from the request's answers (what the wizard opens
 * with when nothing is saved yet).
 */
export const getSchoolSetupOutputSchema = z.object({
  requestId: z.string(),
  hasLogo: z.boolean(),
  setup: schoolSetupDtoSchema.nullable(),
  proposedDraft: schoolSetupDraftSchema,
});

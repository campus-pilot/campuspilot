import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolRegistrationRequestTable } from '@campuspilot/db/schema/school-registration-request';
import { schoolSetupTable } from '@campuspilot/db/schema/school-setup';
import { SYSTEM_ACTIONS } from '@campuspilot/opa/policies/system';
import { ORPCError } from '@orpc/server';
import { eq } from 'drizzle-orm';

import { rpcError, toRpcError } from '../../../errors';
import { platformAdminProcedure } from '../../../index';
import { requireSystemPermission } from '../../../permissions/system';
import { initialSchoolSetupDraft, readRequestFacts, schoolSetupReadySchema, wizardStepOfIssue } from '../../../school-setup/school-setup.contract';
import { handOffSchoolSetup } from '../../../school-setup/school-setup.outbox';
import {
  getSchoolSetupInputSchema,
  getSchoolSetupOutputSchema,
  saveSchoolSetupDraftInputSchema,
  schoolSetupDtoSchema,
  type SchoolSetupDto,
} from './school-setup.dto';

/** Hidden from MCP: creating schools and accounts from a submission is a human platform decision. */
const MCP_META = { exposure: 'hidden', destructive: false, module: 'platform' } as const;

/** A setup may be edited and (re)started only before it runs and after it failed. */
const EDITABLE = new Set(['draft', 'failed']);

type SetupRow = typeof schoolSetupTable.$inferSelect;

function toDto(row: SetupRow): SchoolSetupDto {
  return schoolSetupDtoSchema.parse({
    id: row.id,
    status: row.status,
    draft: row.draft,
    draftStep: row.draftStep,
    draftUpdatedAt: row.draftUpdatedAt,
    attempt: row.attempt,
    schoolId: row.schoolId,
    currentStep: row.currentStep,
    completedSteps: row.completedSteps,
    error: row.error,
    result: row.result,
    lastSubmitError: row.lastSubmitError,
    submittedAt: row.submittedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  });
}

async function requireRequest(db: Parameters<typeof readSetup>[0], requestId: string) {
  const [request] = await db
    .select({ id: schoolRegistrationRequestTable.id, response: schoolRegistrationRequestTable.response, logoS3Key: schoolRegistrationRequestTable.logoS3Key })
    .from(schoolRegistrationRequestTable)
    .where(eq(schoolRegistrationRequestTable.id, requestId))
    .limit(1);
  if (!request) throw rpcError.notFound('School registration request');
  return request;
}

async function readSetup(db: import('@campuspilot/db').DatabaseExecutor, requestId: string, lock = false) {
  const query = db.select().from(schoolSetupTable).where(eq(schoolSetupTable.requestId, requestId)).limit(1);
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

function refuseUnlessEditable(row: SetupRow | null) {
  if (row && !EDITABLE.has(row.status)) {
    throw rpcError.conflict(row.status === 'succeeded' ? 'This school has already been set up.' : 'This setup is running. Wait for it to finish.');
  }
}

/**
 * Platform-admin setup of a real school from a School Onboarding submission
 * (docs/school-onboarding-form.md, "Setting up the school"). The draft is
 * saved as the admin goes; starting hands it to the `SchoolSetup` workflow
 * through the outbox and returns at once.
 */
export const schoolSetupRouter = {
  getSchoolSetup: platformAdminProcedure
    .route({
      summary: 'Get a school setup',
      description: 'Read the saved setup of a School Onboarding submission with its progress, or the draft proposed from its answers. Requires system-administrator permission.',
      tags: ['System Admin', 'Leads'],
    })
    .meta({ mcp: { ...MCP_META, access: 'read' } })
    .input(getSchoolSetupInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_SCHOOL_REGISTRATION_REQUESTS))
    .output(getSchoolSetupOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const request = await requireRequest(context.db, input.requestId);
        const row = await readSetup(context.db, input.requestId);
        const proposedDraft = initialSchoolSetupDraft(readRequestFacts(request.response, request.logoS3Key !== null), new Date());
        return { requestId: request.id, hasLogo: request.logoS3Key !== null, setup: row ? toDto(row) : null, proposedDraft };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  saveSchoolSetupDraft: platformAdminProcedure
    .route({
      summary: 'Save a school setup draft',
      description: 'Save the setup of a School Onboarding submission as it stands, to continue later. Refused while the setup runs or once it succeeded. Requires system-administrator permission.',
      tags: ['System Admin', 'Leads'],
    })
    .meta({ mcp: { ...MCP_META, access: 'write' } })
    .input(saveSchoolSetupDraftInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.MANAGE_SCHOOL_SETUP))
    .output(schoolSetupDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          await requireRequest(transaction, input.requestId);
          const existing = await readSetup(transaction, input.requestId, true);
          refuseUnlessEditable(existing);
          const values = { draft: input.draft, draftStep: input.step, draftUpdatedAt: new Date(), draftUpdatedBy: context.session.user.id };
          const [row] = existing
            ? await transaction.update(schoolSetupTable).set(values).where(eq(schoolSetupTable.id, existing.id)).returning()
            : await transaction.insert(schoolSetupTable).values({ requestId: input.requestId, ...values }).returning();
          if (!row) throw rpcError.internal();
          return toDto(row);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  startSchoolSetup: platformAdminProcedure
    .route({
      summary: 'Start a school setup',
      description:
        'Save the setup of a School Onboarding submission and run it: the worker creates the school, its trial and feature adjustments, session and examinations, classes with sections and subjects, examination plans, and adds the admin as manager and the contact as principal and owner. Returns at once; a failed setup is started again the same way and continues where it stopped. Requires system-administrator permission.',
      tags: ['System Admin', 'Leads'],
    })
    .meta({ mcp: { ...MCP_META, access: 'write' } })
    .input(saveSchoolSetupDraftInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.MANAGE_SCHOOL_SETUP))
    .output(schoolSetupDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const ready = schoolSetupReadySchema.safeParse(input.draft);
        if (!ready.success) {
          throw new ORPCError('BAD_REQUEST', {
            message: 'Some answers need attention before the school can be set up.',
            data: { issues: ready.error.issues.map((issue) => ({ path: issue.path.map(String), step: wizardStepOfIssue(issue.path), message: issue.message })) },
          });
        }
        const row = await context.db.transaction(async (transaction) => {
          await requireRequest(transaction, input.requestId);
          const existing = await readSetup(transaction, input.requestId, true);
          refuseUnlessEditable(existing);
          if (!existing?.schoolId) {
            const [taken] = await transaction.select({ id: schoolTable.id }).from(schoolTable).where(eq(schoolTable.slug, input.draft.school.slug)).limit(1);
            if (taken) {
              throw new ORPCError('BAD_REQUEST', {
                message: 'Another school already uses this address.',
                data: { issues: [{ path: ['school', 'slug'], step: 'school', message: 'Another school already uses this address.' }] },
              });
            }
          }
          const now = new Date();
          const run = {
            draft: input.draft,
            draftStep: input.step,
            draftUpdatedAt: now,
            draftUpdatedBy: context.session.user.id,
            status: 'queued' as const,
            requestedBy: context.session.user.id,
            error: null,
            result: null,
            startRequestedAt: now,
            submittedAt: null,
            submitInvocationId: null,
            submitAttempts: 0,
            lastSubmitError: null,
            invocationId: null,
            startedAt: null,
            finishedAt: null,
          };
          const [saved] = existing
            ? await transaction
                .update(schoolSetupTable)
                .set({ ...run, attempt: existing.status === 'failed' ? existing.attempt + 1 : existing.attempt })
                .where(eq(schoolSetupTable.id, existing.id))
                .returning()
            : await transaction.insert(schoolSetupTable).values({ requestId: input.requestId, ...run }).returning();
          if (!saved) throw rpcError.internal();
          return saved;
        });
        handOffSchoolSetup(row.id, context.db);
        return toDto(row);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};

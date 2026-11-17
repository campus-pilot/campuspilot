import type { DatabaseExecutor } from '@campuspilot/db';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolTrialTable } from '@campuspilot/db/schema/school-trial';
import { SYSTEM_ACTIONS } from '@campuspilot/opa/policies/system';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { rpcError, toRpcError } from '../../../errors';
import { protectedProcedure } from '../../../index';
import { requireSystemPermission } from '../../../permissions/system';
import { schoolIdInputSchema } from '../school/school.dto';
import {
  endSchoolTrialInputSchema,
  schoolTrialDtoSchema,
  startSchoolTrialInputSchema,
  updateSchoolTrialInputSchema,
} from './school-trial.dto';
import {
  listSchoolTrials,
  parseTrialEnd,
  readSchoolTrial,
  startSchoolTrial,
  trialOverlapConflict,
} from './school-trial.service';

/**
 * Locks the school row so two administrators changing one school's trials
 * (or its tier) are applied one after the other. NOT_FOUND for a school that
 * does not exist.
 */
async function lockSchool(db: DatabaseExecutor, schoolId: string): Promise<void> {
  const [school] = await db.select({ id: schoolTable.id }).from(schoolTable).where(eq(schoolTable.id, schoolId)).limit(1).for('update');
  if (!school) throw rpcError.notFound('School');
}

/** The school's trial with that id; NOT_FOUND when the school has none. */
async function requireTrial(db: DatabaseExecutor, schoolId: string, trialId: string) {
  const trial = await readSchoolTrial(db, schoolId, trialId);
  if (!trial) throw rpcError.notFound('Trial');
  return trial;
}

/**
 * Trials of a tier given to a school by a platform administrator
 * (docs/school-trials.md). While a trial is active the school's plan is the
 * higher of its subscription and the trial's tier; it ends by itself at its
 * end. Every procedure needs the platform's school actions and is hidden
 * from MCP: what a school has is a human platform decision, made in the
 * admin app, like a suspension.
 */
export const schoolTrialRouter = {
  listSchoolTrials: protectedProcedure
    .route({
      summary: 'List a school\'s trials',
      description: 'List every trial a school was given, newest first, with whether each is active now. Requires system-administrator permission.',
      tags: ['System Admin', 'Schools'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'platform' } })
    .input(schoolIdInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_SCHOOL))
    .output(z.array(schoolTrialDtoSchema))
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db.select({ id: schoolTable.id }).from(schoolTable).where(eq(schoolTable.id, input.id)).limit(1);
        if (!school) throw rpcError.notFound('School');
        return await listSchoolTrials(context.db, school.id);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  startSchoolTrial: protectedProcedure
    .route({
      summary: 'Start a trial for a school',
      description:
        'Give a school a trial of a tier (plus, pro or enterprise), starting now and ending at endsAt (in the future, at most a year ahead). While it runs the school has the higher of its subscribed tier and the trial\'s tier; it ends by itself. Refused when the school already has an active trial. Requires system-administrator permission.',
      tags: ['System Admin', 'Schools'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'write', destructive: false, module: 'platform' } })
    .input(startSchoolTrialInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_SCHOOL))
    .output(schoolTrialDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const endsAt = parseTrialEnd(input.endsAt);
        return await context.db.transaction(async (transaction) => {
          await lockSchool(transaction, input.id);
          return await startSchoolTrial(transaction, { schoolId: input.id, tier: input.tier, endsAt, createdBy: context.session.user.id });
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateSchoolTrial: protectedProcedure
    .route({
      summary: 'Change a school\'s trial',
      description:
        'Change the tier or the end of a school\'s active trial (extend or shorten it; the end must stay in the future). A trial that has ended or run out cannot be changed. Requires system-administrator permission.',
      tags: ['System Admin', 'Schools'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'write', destructive: true, module: 'platform' } })
    .input(updateSchoolTrialInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_SCHOOL))
    .output(schoolTrialDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          await lockSchool(transaction, input.id);
          const trial = await requireTrial(transaction, input.id, input.trialId);
          if (!trial.active) throw rpcError.conflict('This trial has ended. Start a new trial instead.');
          const endsAt = input.endsAt === undefined ? undefined : parseTrialEnd(input.endsAt, trial.startsAt);
          try {
            await transaction
              .update(schoolTrialTable)
              .set({ tier: input.tier, endsAt, updatedAt: sql`now()` })
              .where(eq(schoolTrialTable.id, trial.id));
          } catch (error) {
            throw trialOverlapConflict(error) ?? error;
          }
          return await requireTrial(transaction, input.id, trial.id);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  endSchoolTrial: protectedProcedure
    .route({
      summary: 'End a school\'s trial',
      description:
        'End a school\'s active trial now. The school then has its subscribed tier, or no plan (read-only) without one. Ending a trial that has already ended or run out changes nothing. Requires system-administrator permission.',
      tags: ['System Admin', 'Schools'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'write', destructive: true, module: 'platform' } })
    .input(endSchoolTrialInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_SCHOOL))
    .output(schoolTrialDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          await lockSchool(transaction, input.id);
          const trial = await requireTrial(transaction, input.id, input.trialId);
          // Only an active trial is ended: one that ran out keeps its own end,
          // so `ended_at` always lies within the trial's time.
          if (!trial.active) return trial;
          await transaction
            .update(schoolTrialTable)
            .set({ endedAt: sql`now()`, endedBy: context.session.user.id, updatedAt: sql`now()` })
            .where(eq(schoolTrialTable.id, trial.id));
          return await requireTrial(transaction, input.id, trial.id);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};

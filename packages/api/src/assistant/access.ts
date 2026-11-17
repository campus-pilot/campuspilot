import type { DatabaseExecutor } from '@campuspilot/db';
import { readSchoolFeatureConfig } from '@campuspilot/db/feature-flags/store';
import type { Role } from '@campuspilot/db/schema/jsonb/role';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import { ORPCError } from '@orpc/server';
import { and, eq } from 'drizzle-orm';

import { isSchoolFeatureEnabled, schoolFeatureDisabledError } from '../feature-flags/feature-flags.service';
import { isSchoolSuspended, schoolSuspendedError } from '../school-suspension/school-suspension.service';
import { SCHOOL_SUSPENDED_MESSAGE } from '../school-suspension/school-suspension.contract';
import { spendReachedLimit } from './money';
import { readAssistantEnabledRoles } from './roles';
import { schoolMonthSpendUsd } from './spend';

/**
 * Why a user may not use the assistant in a school now, each its own fact:
 * - `feature_disabled`: the school's `assistant` feature flag is off;
 * - `not_member`: the user is not a member of the school;
 * - `config_invalid`: the flag's stored settings no longer match their schema;
 * - `role_not_enabled`: the assistant is not switched on for any of the
 *   user's roles (the school's role list, `school_assistant_access_role`);
 * - `school_suspended`: the school is suspended, so it is read-only: the
 *   user still sees the assistant and their conversations, and cannot start
 *   or continue a turn (docs/school-suspension.md);
 * - `limit_reached`: the school's saved spend this IST month reached its
 *   monthly limit.
 */
export type AssistantAccessRefusalCode =
  | 'feature_disabled'
  | 'not_member'
  | 'config_invalid'
  | 'role_not_enabled'
  | 'school_suspended'
  | 'limit_reached';

export type AssistantAccessRefusal = { code: AssistantAccessRefusalCode; message: string };

/**
 * Who may use the assistant, as facts. `allowed` (may start or continue a
 * turn now) holds only when every one of them does. Seeing the assistant at
 * all (its pages, one's own history, delete, stop, decline) needs every fact
 * but the suspension and the limit: `featureEnabled`, `member` and a
 * non-empty `allowedRoles` (`canSee` in `packages/assistant/src/access.ts`).
 */
export type AssistantAccessDecision = {
  featureEnabled: boolean;
  member: boolean;
  /** The user's roles the assistant is switched on for in the school. */
  allowedRoles: Role[];
  /** Whether the school is suspended (read-only). False when the decision stopped before reading it. */
  suspended: boolean;
  /**
   * The school's monthly USD limit as two explicit facts: whether it is
   * known (it is not when the decision stopped before reading the flag's
   * settings), and then the amount, null meaning "no limit".
   */
  limit: AssistantLimit;
  /** Whether the school's spend this IST month reached its limit (false without a limit). */
  limitReached: boolean;
  /**
   * Whether the school's assistant feature has voice switched on
   * (`config.voice.enabled`). False when the decision stopped before reading
   * the settings. It never grants use on its own: voice also needs `allowed`
   * and a voice model on the platform (the assistant package decides that).
   */
  voiceEnabled: boolean;
  allowed: boolean;
  /** The first fact that refuses use, for the user; null when allowed. */
  refusal: AssistantAccessRefusal | null;
};

/** See `AssistantAccessDecision.limit`. */
export type AssistantLimit = { known: false } | { known: true; monthlyLimitUsd: number | null };

const MESSAGES: Record<AssistantAccessRefusalCode, string> = {
  feature_disabled: 'The AI assistant is not enabled for this school.',
  not_member: 'You are not a member of this school.',
  config_invalid:
    'The AI assistant’s settings for this school are not valid. A platform administrator must save them again.',
  role_not_enabled:
    'Your role cannot use the AI assistant in this school. Your principal or manager can switch it on in Settings.',
  school_suspended: SCHOOL_SUSPENDED_MESSAGE,
  limit_reached:
    'This school has reached its AI assistant limit for this month. The assistant is available again on the 1st.',
};

function refused(
  facts: Omit<AssistantAccessDecision, 'allowed' | 'refusal'>,
  code: AssistantAccessRefusalCode,
): AssistantAccessDecision {
  return { ...facts, allowed: false, refusal: { code, message: MESSAGES[code] } };
}

/**
 * Whether a user may use the in-app assistant in a school, and why not. The
 * one decision every enforcement point uses: the `/model/*` procedures (use
 * for sending and approving, every fact but the limit for history, streams,
 * delete, stop and decline), the in-process token issue, the open-stream
 * recheck and the worker before every model request and tool call.
 *
 * Use is role-based only: the feature is active AND the user holds at least
 * one role the assistant is switched on for (the school's one role list,
 * which the platform administrator and the school's principal both edit)
 * AND the school is not suspended AND it is under its monthly limit. No OPA
 * grant is involved
 * (there is no "use the assistant" permission); every tool call is still
 * authorized by OPA as the user.
 *
 * The flag is read here directly (enabled and config together) rather than
 * through the gate helper, because use needs the config anyway. The limit
 * check reads the cached month spend (`schoolMonthSpendUsd`, up to 10
 * minutes old) and only when everything else allows use.
 */
export async function resolveAssistantAccess(
  db: DatabaseExecutor,
  input: { schoolId: string; userId: string; now?: Date },
): Promise<AssistantAccessDecision> {
  const { schoolId, userId } = input;
  // The same question every gate asks, so the assistant follows the catalogue's defaults and requirements.
  const featureEnabled = await isSchoolFeatureEnabled(db, schoolId, 'assistant');
  const base = {
    featureEnabled,
    member: false,
    allowedRoles: [] as Role[],
    suspended: false,
    limit: { known: false } as AssistantLimit,
    limitReached: false,
    voiceEnabled: false,
  };
  if (!featureEnabled) return refused(base, 'feature_disabled');

  const [membership, roleRows] = await Promise.all([
    db
      .select({ userId: schoolMemberTable.userId })
      .from(schoolMemberTable)
      .where(and(eq(schoolMemberTable.schoolId, schoolId), eq(schoolMemberTable.userId, userId)))
      .limit(1),
    db
      .select({ role: schoolUserRoleTable.role })
      .from(schoolUserRoleTable)
      .where(and(eq(schoolUserRoleTable.schoolId, schoolId), eq(schoolUserRoleTable.userId, userId))),
  ]);
  const member = membership.length > 0;
  const facts = { ...base, member };
  if (!member) return refused(facts, 'not_member');

  const stored = await readSchoolFeatureConfig(db, schoolId, 'assistant');
  if (stored.status === 'invalid') return refused(facts, 'config_invalid');
  const monthlyLimitUsd = stored.config?.monthlyLimitUsd ?? null;

  const switchedOn = await readAssistantEnabledRoles(db, schoolId);
  const allowedRoles = [...new Set(roleRows.map((row) => row.role))].filter((role) => switchedOn.has(role));
  const withRoles = {
    ...facts,
    allowedRoles,
    limit: { known: true, monthlyLimitUsd } as AssistantLimit,
    voiceEnabled: stored.config?.voice.enabled ?? false,
  };
  if (allowedRoles.length === 0) return refused(withRoles, 'role_not_enabled');

  // After the role: someone who may not see the assistant learns nothing about the school's suspension.
  const suspended = await isSchoolSuspended(db, schoolId);
  const withSuspension = { ...withRoles, suspended };
  if (suspended) return refused(withSuspension, 'school_suspended');

  const limitReached =
    monthlyLimitUsd !== null && spendReachedLimit(await schoolMonthSpendUsd(db, schoolId, input.now), monthlyLimitUsd);
  const decided = { ...withSuspension, limitReached };
  if (limitReached) return refused(decided, 'limit_reached');
  return { ...decided, allowed: true, refusal: null };
}

/**
 * The error a refused request gets. A disabled feature is the platform's
 * standard disabled-feature FORBIDDEN (`readSchoolFeatureDisabled` tells it
 * apart); a suspended school is the platform's standard suspended-school
 * FORBIDDEN (`isSchoolSuspendedError`); a reached limit is
 * PRECONDITION_FAILED (the user is allowed, the school's budget is not);
 * every other refusal is FORBIDDEN. Each of those carries `data.reason`
 * with its code and the user-facing message.
 */
export function assistantAccessError(refusal: AssistantAccessRefusal): ORPCError<string, unknown> {
  if (refusal.code === 'feature_disabled') return schoolFeatureDisabledError('assistant');
  if (refusal.code === 'school_suspended') return schoolSuspendedError();
  if (refusal.code === 'limit_reached') {
    return new ORPCError('PRECONDITION_FAILED', { message: refusal.message, data: { reason: refusal.code } });
  }
  return new ORPCError('FORBIDDEN', { message: refusal.message, data: { reason: refusal.code } });
}

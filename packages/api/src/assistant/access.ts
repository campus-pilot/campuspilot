import type { DatabaseExecutor } from '@campuspilot/db';
import { readSchoolFeatureConfig } from '@campuspilot/db/feature-flags/store';
import { schoolAssistantAccessRoleTable } from '@campuspilot/db/schema/assistant';
import type { Role } from '@campuspilot/db/schema/jsonb/role';
import { schoolFeatureFlagTable } from '@campuspilot/db/schema/school-feature-flag';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import { ORPCError } from '@orpc/server';
import { and, eq } from 'drizzle-orm';

import { schoolFeatureDisabledError } from '../feature-flags/feature-flags.service';
import { spendReachedLimit } from './money';
import { schoolMonthSpendUsd } from './spend';

/**
 * Why a user may not use the assistant in a school now, each its own fact:
 * - `feature_disabled`: the school's `assistant` feature flag is off;
 * - `not_member`: the user is not a member of the school;
 * - `config_invalid`: the flag's stored settings no longer match their schema;
 * - `role_not_enabled`: none of the user's roles is both eligible (flag
 *   config) and switched on by the school (`school_assistant_access_role`);
 * - `limit_reached`: the school's saved spend this IST month reached its
 *   monthly limit.
 */
export type AssistantAccessRefusalCode =
  | 'feature_disabled'
  | 'not_member'
  | 'config_invalid'
  | 'role_not_enabled'
  | 'limit_reached';

export type AssistantAccessRefusal = { code: AssistantAccessRefusalCode; message: string };

/**
 * Who may use the assistant, as facts. `allowed` (may start or continue a
 * turn now) holds only when every one of them does; reading one's own
 * history needs only `featureEnabled` and `member`.
 */
export type AssistantAccessDecision = {
  featureEnabled: boolean;
  member: boolean;
  /** The user's roles that are eligible and switched on by the school. */
  allowedRoles: Role[];
  /** The school's monthly USD limit; null when it has none (or it is not known). */
  monthlyLimitUsd: number | null;
  /** Whether the school's spend this IST month reached its limit (false without a limit). */
  limitReached: boolean;
  allowed: boolean;
  /** The first fact that refuses use, for the user; null when allowed. */
  refusal: AssistantAccessRefusal | null;
};

const MESSAGES: Record<AssistantAccessRefusalCode, string> = {
  feature_disabled: 'The AI assistant is not enabled for this school.',
  not_member: 'You are not a member of this school.',
  config_invalid:
    'The AI assistant’s settings for this school are not valid. A platform administrator must save them again.',
  role_not_enabled:
    'Your role cannot use the AI assistant in this school. Your principal or manager can switch it on in Settings.',
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
 * for sending and approving, the read facts for history and streams), the
 * in-process token issue, the open-stream recheck and the worker before every
 * model request.
 *
 * Use is role-based only: the flag is enabled AND the user holds at least
 * one role that is in the flag's `eligibleRoles` AND that the school switched
 * on AND the school is under its monthly limit. No OPA grant is involved
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
  const [flag] = await db
    .select({ enabled: schoolFeatureFlagTable.enabled })
    .from(schoolFeatureFlagTable)
    .where(and(eq(schoolFeatureFlagTable.schoolId, schoolId), eq(schoolFeatureFlagTable.feature, 'assistant')))
    .limit(1);
  const featureEnabled = flag?.enabled ?? false;
  const base = { featureEnabled, member: false, allowedRoles: [] as Role[], monthlyLimitUsd: null, limitReached: false };
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
  const eligible = new Set<Role>(stored.config?.eligibleRoles ?? []);
  const monthlyLimitUsd = stored.config?.monthlyLimitUsd ?? null;

  const switchedOn = new Set<Role>(
    (
      await db
        .select({ role: schoolAssistantAccessRoleTable.role })
        .from(schoolAssistantAccessRoleTable)
        .where(eq(schoolAssistantAccessRoleTable.schoolId, schoolId))
    ).map((row) => row.role),
  );
  const allowedRoles = [...new Set(roleRows.map((row) => row.role))].filter(
    (role) => eligible.has(role) && switchedOn.has(role),
  );
  const withRoles = { ...facts, allowedRoles, monthlyLimitUsd };
  if (allowedRoles.length === 0) return refused(withRoles, 'role_not_enabled');

  const limitReached =
    monthlyLimitUsd !== null && spendReachedLimit(await schoolMonthSpendUsd(db, schoolId, input.now), monthlyLimitUsd);
  const decided = { ...withRoles, limitReached };
  if (limitReached) return refused(decided, 'limit_reached');
  return { ...decided, allowed: true, refusal: null };
}

/**
 * The error a refused request gets. A disabled feature is the platform's
 * standard disabled-feature FORBIDDEN (`readSchoolFeatureDisabled` tells it
 * apart); a reached limit is PRECONDITION_FAILED (the user is allowed, the
 * school's budget is not); every other refusal is FORBIDDEN. Each carries
 * `data.reason` with its code and the user-facing message.
 */
export function assistantAccessError(refusal: AssistantAccessRefusal): ORPCError<string, unknown> {
  if (refusal.code === 'feature_disabled') return schoolFeatureDisabledError('assistant');
  if (refusal.code === 'limit_reached') {
    return new ORPCError('PRECONDITION_FAILED', { message: refusal.message, data: { reason: refusal.code } });
  }
  return new ORPCError('FORBIDDEN', { message: refusal.message, data: { reason: refusal.code } });
}

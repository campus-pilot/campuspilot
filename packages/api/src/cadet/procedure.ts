import { MCP_READ_SCOPE } from '@campuspilot/auth/mcp-oauth-policy';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { os } from '@orpc/server';
import { eq } from 'drizzle-orm';

import { rpcError } from '../errors';
import { assertSchoolFeatureEnabled } from '../feature-flags/feature-flags.service';
import type { ProcedureMeta } from '../mcp-metadata';
import type { CadetContext } from './context';

/**
 * oRPC builder of the Cadet Portal. It is typed with `CadetContext`, not the
 * staff `Context`, so cadet procedures can only be mounted on `cadetRouter`
 * and served with a cadet context.
 */
export const co = os.$context<CadetContext>().$meta<ProcedureMeta>({});

/**
 * Accepts only a signed-in cadet and binds who they are from the login:
 * `admissionId` from `cadet_user.admission_id` and `schoolId` from that
 * admission. Cadet procedures therefore never take an admission or school id
 * as input. OAuth connectors are read-only (`mcp:read`); the cadet MCP never
 * grants `mcp:write`, so a procedure that writes is refused for them.
 *
 * The school's `cadet` feature is checked on every call, so switching it off
 * stops existing sessions and connected apps at once, not only new sign-ins.
 * That refusal is FORBIDDEN with
 * `data: { reason: 'SCHOOL_FEATURE_DISABLED', feature: 'cadet' }` (never
 * UNAUTHORIZED: the login is still valid), which the portal shows as "Cadet
 * Portal unavailable" instead of sending the student back to sign-in.
 */
export const cadetProcedure = co.use(async ({ context, next, procedure }) => {
  if (!context.login) throw rpcError.unauthorized();
  if (context.principal.authMethod === 'oauth') {
    const meta = procedure['~orpc'].meta;
    if (
      meta.mcp?.access !== 'read' ||
      !context.principal.oauthGrant.scopes.includes(MCP_READ_SCOPE)
    ) {
      throw rpcError.forbidden(
        `This connection is missing the ${MCP_READ_SCOPE} scope or the tool changes data. Reconnect the Cadet Portal to use it.`,
      );
    }
  }

  const [admission] = await context.db
    .select({ id: admissionTable.id, schoolId: admissionTable.schoolId })
    .from(admissionTable)
    .where(eq(admissionTable.id, context.login.admissionId))
    .limit(1);
  // The login cascades with its admission, so this only happens in the
  // instant between a delete and the session's revocation.
  if (!admission) throw rpcError.unauthorized();
  await assertSchoolFeatureEnabled(context.db, admission.schoolId, 'cadet');

  return next({
    context: {
      cadet: {
        userId: context.login.userId,
        admissionId: admission.id,
        schoolId: admission.schoolId,
      },
    },
  });
});

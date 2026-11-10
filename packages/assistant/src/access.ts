import { checkPermissions } from '@campuspilot/api/permissions/authorization';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';

import type { AssistantSession } from './session';

/** Whether the user holds `school.assistant.use` in the school (OPA, in-process). */
export async function canUseAssistant(session: AssistantSession, schoolId: string): Promise<boolean> {
  const [allowed] = await checkPermissions(session.context, [
    { action: SCHOOL_ACTIONS.USE_ASSISTANT, resource: { kind: 'school', schoolId } },
  ]);
  return allowed === true;
}

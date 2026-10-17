import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import { o } from "../index";
import { checkPermissions } from "./authorization";

/** Session permissions do not grant exam governance. Preserve an independent
 * decision for changes submitted through the legacy session-config endpoint.
 */
export function resolveSessionExamPermission(
  action: typeof SCHOOL_ACTIONS.CREATE_EXAM | typeof SCHOOL_ACTIONS.UPDATE_EXAM,
) {
  return o.middleware<{ canManageSessionExams: boolean }, { schoolId: string }>(
    async ({ context, next, signal }, input) => {
      const [allowed] = await checkPermissions(
        context,
        [{ action, resource: { kind: "school", schoolId: input.schoolId } }],
        signal,
      );
      return next({ context: { canManageSessionExams: allowed === true } });
    },
  );
}

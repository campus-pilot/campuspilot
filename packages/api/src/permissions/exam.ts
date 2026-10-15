import { CLASS_ACTIONS } from "@campuspilot/opa/policies/class";
import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import { o } from "../index";
import { checkPermissions } from "./authorization";
import { rpcError } from "../errors";

type ResultPermissionInput = {
  schoolId: string;
  classId: string;
  approved?: boolean;
  results?: Array<{ approved: boolean }>;
};

/** Approval is an independent permission, including when requested during a save.
 * The revision decision is carried into the locked transaction; handlers cannot
 * bypass the elevated permission when an existing row is already approved.
 */
export const requireExamResultPermissions = o.middleware<
  { canReviseExamResults: boolean },
  ResultPermissionInput
>(async ({ context, next, signal }, input) => {
  const [canApprove, canReviseExamResults] = await checkPermissions(
    context,
    [
      {
        action: CLASS_ACTIONS.APPROVE_EXAM_RESULTS,
        resource: {
          kind: "class",
          schoolId: input.schoolId,
          classId: input.classId,
        },
      },
      {
        action: SCHOOL_ACTIONS.REVISE_EXAM_RESULTS,
        resource: { kind: "school", schoolId: input.schoolId },
      },
    ],
    signal,
  );
  if (
    (input.approved === true || input.results?.some((row) => row.approved)) &&
    !canApprove
  ) {
    throw rpcError.forbidden(
      "Only the assigned class teacher, exam coordinator, principal, or manager can approve results for this class.",
    );
  }
  return next({
    context: { canReviseExamResults: canReviseExamResults === true },
  });
});

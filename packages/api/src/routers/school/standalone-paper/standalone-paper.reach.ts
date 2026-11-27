import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';

import type { Context } from '../../../context';
import { rpcError } from '../../../errors';
import { checkPermissions } from '../../../permissions/authorization';
import { resolveStandalonePaper, type StandalonePaperReach, type StandalonePaperScope } from '../question-paper/question-paper.scope';

/**
 * Which standalone papers of a school the caller reaches
 * (docs/question-papers.md "Quick papers in a school"): the ones they
 * created, and every one when OPA grants them `school.standalone_paper.oversee`
 * there. Read for each request, after the procedure's own read or manage
 * permission, so the two decisions stay apart: `read`/`manage` say what the
 * caller may do with a paper they reach, `oversee` widens which papers they
 * reach. In a personal space the owner (a principal) oversees, which changes
 * nothing for its one member.
 */
export async function standalonePaperReachOf(context: Context, schoolId: string, signal?: AbortSignal): Promise<StandalonePaperReach> {
  const userId = context.session?.user.id;
  if (!userId) throw rpcError.unauthorized();
  const [oversee] = await checkPermissions(context, [{ action: SCHOOL_ACTIONS.OVERSEE_STANDALONE_PAPERS, resource: { kind: 'school', schoolId } }], signal);
  return { userId, oversee: oversee === true };
}

/** The standalone paper the input names, reached by the caller ({@link standalonePaperReachOf}), or NOT_FOUND. */
export async function resolveReachedStandalonePaper(
  context: Context,
  input: { schoolId: string; paperId: string },
  signal?: AbortSignal,
): Promise<StandalonePaperScope> {
  return resolveStandalonePaper(context.db, { schoolId: input.schoolId, paperId: input.paperId }, await standalonePaperReachOf(context, input.schoolId, signal));
}

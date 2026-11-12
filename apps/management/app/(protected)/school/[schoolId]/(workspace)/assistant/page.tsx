import { parseQuestionPaperSeedParams } from '@campuspilot/assistant-contract/attachments';

import { AssistantWorkspace } from '@/components/assistant/assistant-workspace';

/**
 * "Continue in chat" on a question paper links here with the paper's natural
 * key (`?seed=question_paper&sessionId=&examSlug=&classId=&subjectSlug=&modeSlug=`).
 * The seed is read on the server from the address, so the chat starts with it
 * derived, not set by an effect. Anything malformed means no seed: a plain new
 * conversation.
 */
export default async function AssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ schoolId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ schoolId }, query] = await Promise.all([params, searchParams]);
  return <AssistantWorkspace schoolId={schoolId} conversationId={null} seed={parseQuestionPaperSeedParams(query)} />;
}

import { AssistantWorkspace } from '@/components/assistant/assistant-workspace';

export default async function AssistantConversationPage({
  params,
}: {
  params: Promise<{ schoolId: string; conversationId: string }>;
}) {
  const { schoolId, conversationId } = await params;
  return <AssistantWorkspace schoolId={schoolId} conversationId={conversationId} />;
}

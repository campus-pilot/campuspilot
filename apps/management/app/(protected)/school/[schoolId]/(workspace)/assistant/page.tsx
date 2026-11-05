import { AssistantWorkspace } from '@/components/assistant/assistant-workspace';

export default async function AssistantPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  return <AssistantWorkspace schoolId={schoolId} conversationId={null} />;
}

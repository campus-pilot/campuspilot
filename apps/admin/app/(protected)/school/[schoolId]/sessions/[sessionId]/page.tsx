import { SessionDetail } from '@/components/session/session-detail';

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ schoolId: string; sessionId: string }>;
}) {
  const { schoolId, sessionId } = await params;
  return <SessionDetail schoolId={schoolId} sessionId={sessionId} />;
}

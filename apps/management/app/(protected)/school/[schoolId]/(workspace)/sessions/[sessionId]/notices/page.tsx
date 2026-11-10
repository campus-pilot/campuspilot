import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { NoticeList } from '@/components/notices/notice-list';
import { NoticePageGate } from '@/components/notices/notice-page-gate';

export default async function NoticesPage({ params }: { params: Promise<{ schoolId: string; sessionId: string }> }) {
  const scope = await params;
  return (
    <NoticePageGate schoolId={scope.schoolId} action={SCHOOL_ACTIONS.READ_NOTICE}>
      <NoticeList scope={scope} />
    </NoticePageGate>
  );
}

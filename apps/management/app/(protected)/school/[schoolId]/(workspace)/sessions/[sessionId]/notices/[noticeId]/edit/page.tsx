import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { EditNotice } from '@/components/notices/notice-workspace';
import { NoticePageGate } from '@/components/notices/notice-page-gate';

export default async function EditNoticePage({ params }: { params: Promise<{ schoolId: string; sessionId: string; noticeId: string }> }) {
  const scope = await params;
  return (
    <NoticePageGate schoolId={scope.schoolId} action={SCHOOL_ACTIONS.DRAFT_NOTICE}>
      <EditNotice scope={scope} />
    </NoticePageGate>
  );
}

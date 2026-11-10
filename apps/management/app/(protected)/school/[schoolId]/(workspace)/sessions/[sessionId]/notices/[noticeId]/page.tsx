import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { NoticeWorkspace } from '@/components/notices/notice-workspace';
import { NoticePageGate } from '@/components/notices/notice-page-gate';

/** Also the target of the staff "notice published" notification and of a notice's WhatsApp failure alert. */
export default async function NoticePage({ params }: { params: Promise<{ schoolId: string; sessionId: string; noticeId: string }> }) {
  const scope = await params;
  return (
    <NoticePageGate schoolId={scope.schoolId} action={SCHOOL_ACTIONS.READ_NOTICE}>
      <NoticeWorkspace scope={scope} />
    </NoticePageGate>
  );
}

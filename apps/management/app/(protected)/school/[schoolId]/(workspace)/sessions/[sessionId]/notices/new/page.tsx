import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { NewNotice } from '@/components/notices/notice-workspace';
import { NoticePageGate } from '@/components/notices/notice-page-gate';

export default async function NewNoticePage({ params }: { params: Promise<{ schoolId: string; sessionId: string }> }) {
  const scope = await params;
  return (
    <NoticePageGate schoolId={scope.schoolId} action={SCHOOL_ACTIONS.DRAFT_NOTICE}>
      <NewNotice scope={scope} />
    </NoticePageGate>
  );
}

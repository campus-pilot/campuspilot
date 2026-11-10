import type { Metadata } from 'next';
import { NoticeNotFound, NoticeScreen } from '@/components/notices/notice-screen';
import { decodeRouteParam } from '@/lib/route-param';

export const metadata: Metadata = { title: 'Notice' };

export default async function NoticePage({ params }: { params: Promise<{ noticeId: string }> }) {
  const noticeId = decodeRouteParam((await params).noticeId);
  return noticeId === null ? <NoticeNotFound /> : <NoticeScreen noticeId={noticeId} />;
}

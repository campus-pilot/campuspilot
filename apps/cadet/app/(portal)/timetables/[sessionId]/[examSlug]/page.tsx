import type { Metadata } from 'next';
import { TimetableNotFound, TimetableScreen } from '@/components/timetables/timetable-screen';
import { decodeRouteParam } from '@/lib/route-param';

export const metadata: Metadata = { title: 'Timetable' };

export default async function TimetablePage({ params }: { params: Promise<{ sessionId: string; examSlug: string }> }) {
  const raw = await params;
  const sessionId = decodeRouteParam(raw.sessionId);
  const examSlug = decodeRouteParam(raw.examSlug);
  return sessionId === null || examSlug === null ? <TimetableNotFound /> : <TimetableScreen sessionId={sessionId} examSlug={examSlug} />;
}

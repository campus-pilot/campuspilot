'use client';
import { usePathname } from 'next/navigation';
import { ExamSettings } from './exam-settings';
import { ExamTimetableNavbarAction } from './exam-timetable';
import { examHref, type ExamScope } from './exam-model';

/** Navbar actions belong to the exact page, never its descendants. */
export function ExamNavbarActions({ scope }: {
  scope: ExamScope & { classId?: string; studentId?: string };
}) {
  const pathname = usePathname().replace(/\/$/, '');
  const base = examHref(scope, scope.examSlug);
  if (pathname === base) return <ExamSettings scope={scope} placement="navbar" />;
  if (pathname === `${base}/timetable`) return <ExamTimetableNavbarAction scope={scope} />;
  return null;
}

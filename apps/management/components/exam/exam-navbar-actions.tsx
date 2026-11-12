'use client';
import { usePathname } from 'next/navigation';
import { ExamSettings } from './exam-settings';
import { examHref, examResultsHref, type ExamScope } from './exam-model';

/** Navbar actions belong to the exact page, never its descendants. */
export function ExamNavbarActions({ scope }: {
  scope: ExamScope & { classId?: string; studentId?: string };
}) {
  const pathname = usePathname().replace(/\/$/, '');
  const base = examHref(scope, scope.examSlug);
  // The root redirects to a section; the lifecycle action belongs to the root and to Results.
  if (pathname === base || pathname === examResultsHref(scope)) return <ExamSettings scope={scope} placement="navbar" />;
  return null;
}

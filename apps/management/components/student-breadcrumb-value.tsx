'use client';

import { useQuery } from '@tanstack/react-query';
import { orpc } from '@/lib/orpc';

export function StudentBreadcrumbValue({ schoolId, sessionId, studentId }: { schoolId: string; sessionId: string; studentId: string }) {
  const studentQuery = useQuery(orpc.school.getStudent.queryOptions({ input: { schoolId, sessionId, studentId } }));
  return <>{studentQuery.data?.admission.name ?? 'Student'}</>;
}

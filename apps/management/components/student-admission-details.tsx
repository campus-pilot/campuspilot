'use client';

import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { useRouter } from 'next/navigation';
import { orpc } from '@/lib/orpc';
import { AdmissionDetails } from './admission-details';

export function StudentAdmissionDetails({ schoolId, sessionId, studentId }: { schoolId: string; sessionId: string; studentId: string }) {
  const router = useRouter();
  const studentQuery = useQuery(orpc.school.getStudent.queryOptions({ input: { schoolId, sessionId, studentId } }));
  if (studentQuery.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (!studentQuery.data) return <p className="text-sm text-destructive">Unable to load student.</p>;
  const classId = studentQuery.data.classId;
  return <AdmissionDetails schoolId={schoolId} admissionId={studentQuery.data.admissionId} lockedSessionId={sessionId} onRemovedFromClass={classId ? () => router.push(`/school/${encodeURIComponent(schoolId)}/sessions/${encodeURIComponent(sessionId)}/classroom/${encodeURIComponent(classId)}/students`) : undefined} />;
}

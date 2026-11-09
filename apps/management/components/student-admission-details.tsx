'use client';

import { useQuery } from '@tanstack/react-query';
import { Button } from '@campuspilot/ui/components/button';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { orpc } from '@/lib/orpc';
import { AdmissionDetails } from './admission-details';
import { AdmissionPhotoEditor } from './admission-photo-editor';

/**
 * Identifies the student inside the classroom workspace: the admission's
 * photo (editable in place, saved on the admission), name and admission
 * number, plus the way through to the full admission record. Shares the
 * `getAdmission` query with the details below, so a new photo shows at once.
 */
function StudentHeader({ schoolId, admissionId }: { schoolId: string; admissionId: string }) {
  const admissionQuery = useQuery(orpc.school.getAdmission.queryOptions({ input: { schoolId, admissionId } }));
  const admission = admissionQuery.data;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {admission ? <AdmissionPhotoEditor schoolId={schoolId} admission={admission} /> : <span className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />}
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{admission?.name ?? 'Loading student…'}</h2>
          {admission ? <p className="text-xs text-muted-foreground">{admission.admissionNo}</p> : null}
        </div>
      </div>
      <Button asChild variant="outline">
        <Link href={`/school/${encodeURIComponent(schoolId)}/admission/${encodeURIComponent(admissionId)}/details`}>View admission <ArrowUpRight aria-hidden /></Link>
      </Button>
    </div>
  );
}

export function StudentAdmissionDetails({ schoolId, sessionId, studentId }: { schoolId: string; sessionId: string; studentId: string }) {
  const router = useRouter();
  const studentQuery = useQuery(orpc.school.getStudent.queryOptions({ input: { schoolId, sessionId, studentId } }));
  if (studentQuery.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (!studentQuery.data) return <p className="text-sm text-destructive">Unable to load student.</p>;
  const { admissionId, classId } = studentQuery.data;
  return (
    <section className="flex flex-col gap-4">
      <StudentHeader schoolId={schoolId} admissionId={admissionId} />
      <AdmissionDetails schoolId={schoolId} admissionId={admissionId} lockedSessionId={sessionId} onRemovedFromClass={classId ? () => router.push(`/school/${encodeURIComponent(schoolId)}/sessions/${encodeURIComponent(sessionId)}/classroom/${encodeURIComponent(classId)}/students`) : undefined} />
    </section>
  );
}

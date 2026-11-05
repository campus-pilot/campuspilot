'use client';

import type { AssistantRecordsView } from '@campuspilot/assistant-contract/views';
import { AssistantRecordList, type AssistantRecord } from '@campuspilot/components/assistant';
import { Avatar, AvatarFallback, AvatarImage } from '@campuspilot/ui/components/avatar';
import { Badge } from '@campuspilot/ui/components/badge';
import { useQueries } from '@tanstack/react-query';
import { ClipboardCheck, GraduationCap } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { examStatusLabel } from '@/components/exam/exam-model';
import { schoolHref, schoolSessionHref } from '@/components/school-route';
import { roleLabels } from '@/components/staff-role-picker';
import { getAdmissionPhotoUrl } from '@/lib/admission-photo';
import { orpc } from '@/lib/orpc';

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function PersonTile({ name, src }: { name: string; src?: string | null }) {
  return (
    <Avatar>
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

function IconTile({ icon: Icon }: { icon: typeof GraduationCap }) {
  return (
    <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

const renderLink = ({ href, className, children }: { href: string; className: string; children: ReactNode }) => (
  <Link href={href} className={className}>
    {children}
  </Link>
);

/** Turns per-id query results into rows, counting the ones the user cannot see. */
function RecordListFromQueries({
  title,
  results,
}: {
  title?: string;
  results: Array<{ isPending: boolean; record: AssistantRecord | null }>;
}) {
  const records = results.flatMap((result) => (result.record ? [result.record] : []));
  const loading = results.filter((result) => result.isPending).length;
  const unavailable = results.length - records.length - loading;
  return (
    <AssistantRecordList title={title} records={records} loadingCount={loading} unavailable={unavailable} renderLink={renderLink} />
  );
}

function AdmissionRecords({ schoolId, view }: { schoolId: string; view: AssistantRecordsView }) {
  const results = useQueries({
    queries: view.ids.map((admissionId) => orpc.school.getAdmission.queryOptions({ input: { schoolId, admissionId } })),
  });
  return (
    <RecordListFromQueries
      title={view.title}
      results={results.map((result) => ({
        isPending: result.isPending,
        record: result.data
          ? {
              id: result.data.id,
              leading: <PersonTile name={result.data.name} src={getAdmissionPhotoUrl(schoolId, result.data.id, result.data.photoS3Key)} />,
              title: result.data.name,
              subtitle: `Admission ${result.data.admissionNo}`,
              badge: result.data.unregisteredAt ? <Badge variant="secondary">Unregistered</Badge> : <Badge>Registered</Badge>,
              href: schoolHref(schoolId, `/admission/${result.data.id}`),
            }
          : null,
      }))}
    />
  );
}

function StudentRecords({ schoolId, sessionId, view }: { schoolId: string; sessionId: string; view: AssistantRecordsView }) {
  const results = useQueries({
    queries: view.ids.map((studentId) => orpc.school.getStudent.queryOptions({ input: { schoolId, sessionId, studentId } })),
  });
  return (
    <RecordListFromQueries
      title={view.title}
      results={results.map((result) => {
        const student = result.data;
        return {
          isPending: result.isPending,
          record: student
            ? {
                id: student.id,
                leading: (
                  <PersonTile
                    name={student.admission.name}
                    src={getAdmissionPhotoUrl(schoolId, student.admissionId, student.admission.photoS3Key)}
                  />
                ),
                title: student.admission.name,
                subtitle: [`Admission ${student.admission.admissionNo}`, student.rollNo ? `Roll ${student.rollNo}` : null]
                  .filter(Boolean)
                  .join(' · '),
                badge: student.classId ? undefined : <Badge variant="secondary">Unassigned</Badge>,
                href: student.classId
                  ? schoolSessionHref(schoolId, sessionId, `/classroom/${student.classId}/students/${student.id}`)
                  : schoolHref(schoolId, `/admission/${student.admissionId}`),
              }
            : null,
        };
      })}
    />
  );
}

function ClassRecords({ schoolId, sessionId, view }: { schoolId: string; sessionId: string; view: AssistantRecordsView }) {
  const results = useQueries({
    queries: view.ids.map((classId) => orpc.school.getClass.queryOptions({ input: { schoolId, classId } })),
  });
  return (
    <RecordListFromQueries
      title={view.title}
      results={results.map((result) => ({
        isPending: result.isPending,
        record: result.data
          ? {
              id: result.data.id,
              leading: <IconTile icon={GraduationCap} />,
              title: result.data.label,
              subtitle: result.data.slug,
              href: schoolSessionHref(schoolId, sessionId, `/classroom/${result.data.id}`),
            }
          : null,
      }))}
    />
  );
}

function ExamRecords({ schoolId, sessionId, view }: { schoolId: string; sessionId: string; view: AssistantRecordsView }) {
  const exams = useQueries({
    queries: view.ids.map((examSlug) => orpc.school.getExam.queryOptions({ input: { schoolId, sessionId, examSlug } })),
  });
  const overviews = useQueries({
    queries: view.ids.map((examSlug) => orpc.school.getExamOverview.queryOptions({ input: { schoolId, sessionId, examSlug } })),
  });
  return (
    <RecordListFromQueries
      title={view.title}
      results={exams.map((result, index) => {
        const overview = overviews[index]?.data;
        return {
          isPending: result.isPending,
          record: result.data
            ? {
                id: result.data.slug,
                leading: <IconTile icon={ClipboardCheck} />,
                title: result.data.name,
                subtitle: overview ? `${overview.planCount} ${overview.planCount === 1 ? 'plan' : 'plans'}` : undefined,
                badge: overview ? <Badge variant="outline">{examStatusLabel(overview.status)}</Badge> : undefined,
                href: schoolSessionHref(schoolId, sessionId, `/exam/${result.data.slug}`),
              }
            : null,
        };
      })}
    />
  );
}

function StaffRecords({ schoolId, view }: { schoolId: string; view: AssistantRecordsView }) {
  const results = useQueries({
    queries: view.ids.map((userId) => orpc.school.getMember.queryOptions({ input: { schoolId, userId } })),
  });
  return (
    <RecordListFromQueries
      title={view.title}
      results={results.map((result) => ({
        isPending: result.isPending,
        record: result.data
          ? {
              id: result.data.userId,
              leading: <PersonTile name={result.data.name || result.data.email} src={result.data.profileImageUrl} />,
              title: result.data.name || 'Pending setup',
              subtitle: result.data.email,
              badge: result.data.roles[0] ? (
                <Badge variant="secondary">
                  {roleLabels[result.data.roles[0].role]}
                  {result.data.roles.length > 1 ? ` +${result.data.roles.length - 1}` : ''}
                </Badge>
              ) : undefined,
              href: schoolHref(schoolId, '/staff'),
            }
          : null,
      }))}
    />
  );
}

/**
 * Records the assistant named, fetched here with the user's own session, so
 * the API's permissions decide what appears. Records that need a session but
 * came without one are shown as unavailable rather than guessed.
 */
export function AssistantRecordsViewBlock({ schoolId, view }: { schoolId: string; view: AssistantRecordsView }) {
  const missingSession = () => (
    <AssistantRecordList title={view.title} records={[]} unavailable={view.ids.length} renderLink={renderLink} />
  );
  switch (view.entity) {
    case 'admission':
      return <AdmissionRecords schoolId={schoolId} view={view} />;
    case 'staff':
      return <StaffRecords schoolId={schoolId} view={view} />;
    case 'student':
      return view.sessionId ? <StudentRecords schoolId={schoolId} sessionId={view.sessionId} view={view} /> : missingSession();
    case 'class':
      return view.sessionId ? <ClassRecords schoolId={schoolId} sessionId={view.sessionId} view={view} /> : missingSession();
    case 'exam':
      return view.sessionId ? <ExamRecords schoolId={schoolId} sessionId={view.sessionId} view={view} /> : missingSession();
  }
}

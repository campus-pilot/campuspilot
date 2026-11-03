'use client';

import { useState } from 'react';
import { AdmissionDetailsView } from '@campuspilot/components/admission';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@campuspilot/ui/components/skeleton';

import { orpc } from '@/lib/orpc';
import { RemoveStudentFromClassAction } from './remove-student-from-class-action';
import { useSchoolSessions, useStoredSchoolSessionId } from './session-selection';

export function AdmissionDetails({ schoolId, admissionId, lockedSessionId, onRemovedFromClass }: { schoolId: string; admissionId: string; lockedSessionId?: string; onRemovedFromClass?: () => void }) {
  const [selectedSessionOverride, setSelectedSessionOverride] = useState<string>();
  const admissionQuery = useQuery(orpc.school.getAdmission.queryOptions({ input: { schoolId, admissionId } }));
  const sessionsQuery = useSchoolSessions(schoolId);
  const storedSessionId = useStoredSchoolSessionId(schoolId);
  const sessions = sessionsQuery.data ?? [];
  const selectedSessionId = lockedSessionId ?? selectedSessionOverride ?? storedSessionId ?? sessions.find(({ isActive }) => isActive)?.id ?? sessions[0]?.id;
  const studentsQuery = useQuery({ ...orpc.school.listStudents.queryOptions({ input: { schoolId, sessionId: selectedSessionId ?? '', limit: 1, filters: { admissionId } } }), enabled: Boolean(selectedSessionId) });
  const student = studentsQuery.data?.items[0];
  const classQuery = useQuery({ ...orpc.school.getClass.queryOptions({ input: { schoolId, classId: student?.classId ?? '' } }), enabled: Boolean(student?.classId) });
  const sectionsQuery = useQuery({ ...orpc.school.listSections.queryOptions({ input: { schoolId, classId: student?.classId ?? '' } }), enabled: Boolean(student?.classId) });
  if (admissionQuery.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  const admission = admissionQuery.data;
  if (!admission) return <p className="text-sm text-destructive">Unable to load admission.</p>;
  const section = sectionsQuery.data?.find(({ id }) => id === student?.sectionId);
  return <AdmissionDetailsView
    admission={admission}
    sessions={sessions.map((session) => ({ id: session.id, name: `${session.sessionStartYear}–${session.sessionEndYear}` }))}
    selectedSessionId={selectedSessionId}
    sessionLocked={Boolean(lockedSessionId)}
    placement={student?.classId && student.sectionId ? { rollNo: student.rollNo, classLabel: classQuery.data?.label ?? null, sectionLabel: section?.label ?? null } : null}
    academicAction={admission.registered && selectedSessionId && student?.classId && student.sectionId && student.rollNo ? <RemoveStudentFromClassAction schoolId={schoolId} sessionId={selectedSessionId} studentId={student.id} studentName={admission.name} rollNo={student.rollNo} onRemoved={onRemovedFromClass} /> : undefined}
    onSessionChange={setSelectedSessionOverride}
  />;
}

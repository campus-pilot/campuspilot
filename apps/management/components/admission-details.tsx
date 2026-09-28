'use client';

import { useState } from 'react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { AdmissionDetailsView } from '@campuspilot/components/admission';
import { ProfileImageEditor } from '@campuspilot/components/profile-image-editor';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@campuspilot/ui/components/skeleton';

import { getAdmissionPhotoUrl, uploadAdmissionPhoto } from '@/lib/admission-photo';
import { orpc } from '@/lib/orpc';
import { RemoveStudentFromClassAction } from './remove-student-from-class-action';
import { RequirePermissions } from './require-permissions';
import { useSchoolSessions, useStoredSchoolSessionId } from './session-selection';

export function AdmissionDetails({ schoolId, admissionId, lockedSessionId, onRemovedFromClass }: { schoolId: string; admissionId: string; lockedSessionId?: string; onRemovedFromClass?: () => void }) {
  const [selectedSessionOverride, setSelectedSessionOverride] = useState<string>();
  const queryClient = useQueryClient();
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
    photoEditor={<RequirePermissions permissions={{ action: SCHOOL_ACTIONS.UPDATE_ADMISSION, resource: { kind: 'school', schoolId } }} fallback={<ProfileImageEditor imageUrl={getAdmissionPhotoUrl(schoolId, admissionId, admission.photoS3Key)} name={admission.name} subject="student photo" label="Photo" description="Used for school records and identity cards. JPEG, PNG, or WebP." canEdit={false} />}><ProfileImageEditor imageUrl={getAdmissionPhotoUrl(schoolId, admissionId, admission.photoS3Key)} name={admission.name} subject="student photo" label="Photo" description="Used for school records and identity cards. JPEG, PNG, or WebP." canEdit={admission.registered} onUpload={async (file, options) => {
      await uploadAdmissionPhoto(schoolId, admissionId, file, options);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.school.getAdmission.queryKey({ input: { schoolId, admissionId } }) }),
        queryClient.invalidateQueries({ queryKey: orpc.school.listAdmissions.queryKey({ input: { schoolId } }) }),
      ]);
    }} /></RequirePermissions>}
    onSessionChange={setSelectedSessionOverride}
  />;
}

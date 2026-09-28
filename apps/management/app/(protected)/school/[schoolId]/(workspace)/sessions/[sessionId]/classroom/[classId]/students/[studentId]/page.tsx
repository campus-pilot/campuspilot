import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { StudentAdmissionDetails } from '@/components/student-admission-details';

export default async function StudentDetailsPage({ params }: { params: Promise<{ schoolId: string; sessionId: string; studentId: string }> }) {
  const { schoolId, sessionId, studentId } = await params;
  return <RequirePermissions permissions={[
    { action: SCHOOL_ACTIONS.READ_STUDENT, resource: { kind: 'school', schoolId } },
    { action: SCHOOL_ACTIONS.READ_ADMISSION, resource: { kind: 'school', schoolId } },
    { action: SCHOOL_ACTIONS.LIST_SESSIONS, resource: { kind: 'school', schoolId } },
    { action: SCHOOL_ACTIONS.LIST_STUDENTS, resource: { kind: 'school', schoolId } },
    { action: SCHOOL_ACTIONS.LIST_CLASSES, resource: { kind: 'school', schoolId } },
    { action: SCHOOL_ACTIONS.READ_CLASS, resource: { kind: 'school', schoolId } },
    { action: SCHOOL_ACTIONS.LIST_SECTIONS, resource: { kind: 'school', schoolId } },
  ]} fallback={<p className="text-sm text-muted-foreground">You do not have access to this student.</p>}><StudentAdmissionDetails schoolId={schoolId} sessionId={sessionId} studentId={studentId} /></RequirePermissions>;
}

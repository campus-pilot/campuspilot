import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { ClassStudentsTable } from '@/components/class-students-table';
import { RequirePermissions } from '@/components/require-permissions';

export default async function ClassStudentsPage({ params }: { params: Promise<{ schoolId: string; sessionId: string; classId: string }> }) {
  const { schoolId, sessionId, classId } = await params;
  return <RequirePermissions permissions={[
    { action: SCHOOL_ACTIONS.LIST_STUDENTS, resource: { kind: 'school', schoolId } },
    { action: SCHOOL_ACTIONS.LIST_SECTIONS, resource: { kind: 'school', schoolId } },
  ]} fallback={<p className="text-sm text-muted-foreground">You do not have access to students.</p>}><ClassStudentsTable schoolId={schoolId} sessionId={sessionId} classId={classId} /></RequirePermissions>;
}

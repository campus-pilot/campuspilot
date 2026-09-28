import type { ReactNode } from 'react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { AdmissionWorkspace } from '@/components/admission-workspace';
import { RequirePermissions } from '@/components/require-permissions';

export default async function AdmissionLayout({ children, params }: { children: ReactNode; params: Promise<{ schoolId: string; admissionId: string }> }) {
  const { schoolId, admissionId } = await params;
  return <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.READ_ADMISSION, resource: { kind: 'school', schoolId } }} fallback={<p className="text-sm text-muted-foreground">You do not have access to this admission.</p>}><AdmissionWorkspace schoolId={schoolId} admissionId={admissionId}>{children}</AdmissionWorkspace></RequirePermissions>;
}

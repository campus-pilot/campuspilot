import { AdmissionDetails } from '@/components/admission-details';
import { AdmissionDocuments } from '@/components/admission-documents';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';

export default async function AdmissionDetailsPage({ params }: { params: Promise<{ schoolId: string; admissionId: string }> }) {
  const { schoolId, admissionId } = await params;
  return (
    <div className="flex flex-col gap-8">
      <RequirePermissions permissions={[
        { action: SCHOOL_ACTIONS.LIST_SESSIONS, resource: { kind: 'school', schoolId } },
        { action: SCHOOL_ACTIONS.LIST_STUDENTS, resource: { kind: 'school', schoolId } },
        { action: SCHOOL_ACTIONS.LIST_CLASSES, resource: { kind: 'school', schoolId } },
        { action: SCHOOL_ACTIONS.READ_CLASS, resource: { kind: 'school', schoolId } },
        { action: SCHOOL_ACTIONS.LIST_SECTIONS, resource: { kind: 'school', schoolId } },
      ]}>
        <AdmissionDetails schoolId={schoolId} admissionId={admissionId} />
      </RequirePermissions>
      <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.READ_ADMISSION_SETTINGS, resource: { kind: 'school', schoolId } }}>
        <section className="border-t pt-8">
          <AdmissionDocuments schoolId={schoolId} admissionId={admissionId} />
        </section>
      </RequirePermissions>
    </div>
  );
}

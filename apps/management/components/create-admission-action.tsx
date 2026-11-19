'use client';

import { useState } from 'react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { AdmissionFormDialog, type AdmissionFormValue } from '@campuspilot/components/admission';
import { IssuedCadetPasswordDialog, type IssuedCadetPasswordDetails } from '@campuspilot/components/cadet-portal';
import { Button } from '@campuspilot/ui/components/button';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';

import { client, orpc } from '@/lib/orpc';
import { RequireFeature } from './require-feature';
import { RequirePermissions } from './require-permissions';

/**
 * A new admission. "WhatsApp number is the same as phone number" starts
 * checked, and with it "WhatsApp number verified" (D-4: both are form
 * defaults only; staff can untick either and the dialog submits the choices).
 */
const emptyAdmission: AdmissionFormValue = {
  name: '',
  admissionNo: '',
  admissionClassId: null,
  address: '',
  phoneNo: '',
  whatsappNo: null,
  whatsappSameAsPhone: true,
  whatsappVerified: true,
  whatsappConsent: false,
  email: null,
  dob: '',
  fatherName: '',
  motherName: '',
};

/** A password issued with a new admission, kept only until staff close the dialog. */
type IssuedForAdmission = { studentName: string; details: IssuedCadetPasswordDetails };

/**
 * "New admission" with its feature and permission gates (separate gates; the
 * action needs both), so the Admission navbar and empty states render the
 * same entry point.
 */
export function CreateAdmissionAction({ schoolId, variant = 'default' }: { schoolId: string; variant?: 'default' | 'outline' }) {
  return (
    <RequireFeature schoolId={schoolId} feature="studentManagement">
      <RequirePermissions permissions={[
        { action: SCHOOL_ACTIONS.CREATE_ADMISSION, resource: { kind: 'school', schoolId } },
        { action: SCHOOL_ACTIONS.LIST_CLASSES, resource: { kind: 'school', schoolId } },
      ]}>
        <CreateAdmissionButton schoolId={schoolId} variant={variant} />
      </RequirePermissions>
    </RequireFeature>
  );
}

function CreateAdmissionButton({ schoolId, variant }: { schoolId: string; variant: 'default' | 'outline' }) {
  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedForAdmission | null>(null);
  const queryClient = useQueryClient();
  const classesQuery = useQuery(orpc.school.listClasses.queryOptions({ input: { schoolId } }));
  const dialog = (cadetPasswordOption: boolean) => (
    <AdmissionFormDialog
      open
      mode="create"
      defaultValues={emptyAdmission}
      classes={(classesQuery.data ?? []).map(({ id, label }) => ({ id, label }))}
      cadetPasswordOption={cadetPasswordOption}
      onOpenChange={setOpen}
      onSubmit={async (value, { generateCadetPassword }) => {
        const created = await client.school.createAdmission({ schoolId, ...value, generateCadetPassword });
        await queryClient.invalidateQueries({ queryKey: orpc.school.listAdmissions.queryKey({ input: { schoolId } }) });
        if (created.cadetPassword) setIssued({ studentName: created.name, details: created.cadetPassword });
      }}
    />
  );
  return (
    <>
      <Button type="button" size="sm" variant={variant} onClick={() => setOpen(true)}><Plus aria-hidden />New admission</Button>
      {open ? (
        // The checkbox is offered only in schools that have the Cadet Portal
        // and only to staff who may issue its passwords; the server checks
        // the feature and the permission again.
        <RequireFeature schoolId={schoolId} feature="cadet" fallback={dialog(false)}>
          <RequirePermissions
            permissions={{ action: SCHOOL_ACTIONS.ISSUE_ADMISSION_CADET_PASSWORD, resource: { kind: 'school', schoolId } }}
            fallback={dialog(false)}
            pending={dialog(false)}
          >
            {dialog(true)}
          </RequirePermissions>
        </RequireFeature>
      ) : null}
      <IssuedCadetPasswordDialog
        details={issued?.details ?? null}
        studentName={issued?.studentName ?? ''}
        onClose={() => setIssued(null)}
      />
    </>
  );
}

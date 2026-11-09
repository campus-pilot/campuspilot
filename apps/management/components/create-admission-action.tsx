'use client';

import { useState } from 'react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { AdmissionFormDialog, type AdmissionFormValue } from '@campuspilot/components/admission';
import { IssuedCadetPasswordDialog, type IssuedCadetPasswordDetails } from '@campuspilot/components/cadet-portal';
import { Button } from '@campuspilot/ui/components/button';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';

import { client, orpc } from '@/lib/orpc';
import { RequirePermissions } from './require-permissions';

/**
 * A new admission. "WhatsApp number is the same as phone number" starts
 * checked (D-4: a form default only; the dialog submits the explicit choice).
 */
const emptyAdmission: AdmissionFormValue = {
  name: '',
  admissionNo: '',
  admissionClassId: null,
  address: '',
  phoneNo: '',
  whatsappNo: null,
  whatsappSameAsPhone: true,
  whatsappVerified: false,
  whatsappConsent: false,
  email: null,
  dob: '',
  fatherName: '',
  motherName: '',
};

/** A password issued with a new admission, kept only until staff close the dialog. */
type IssuedForAdmission = { studentName: string; details: IssuedCadetPasswordDetails };

export function CreateAdmissionAction({ schoolId }: { schoolId: string }) {
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
      <Button type="button" size="sm" onClick={() => setOpen(true)}><Plus aria-hidden />New admission</Button>
      {open ? (
        // The checkbox is offered only to staff who may issue Cadet Portal
        // passwords; the server checks the same permission again.
        <RequirePermissions
          permissions={{ action: SCHOOL_ACTIONS.ISSUE_ADMISSION_CADET_PASSWORD, resource: { kind: 'school', schoolId } }}
          fallback={dialog(false)}
        >
          {dialog(true)}
        </RequirePermissions>
      ) : null}
      <IssuedCadetPasswordDialog
        details={issued?.details ?? null}
        studentName={issued?.studentName ?? ''}
        onClose={() => setIssued(null)}
      />
    </>
  );
}

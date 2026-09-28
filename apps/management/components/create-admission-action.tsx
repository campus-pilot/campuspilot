'use client';

import { useState } from 'react';
import { AdmissionFormDialog, type AdmissionFormValue } from '@campuspilot/components/admission';
import { Button } from '@campuspilot/ui/components/button';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';

import { client, orpc } from '@/lib/orpc';

const emptyAdmission: AdmissionFormValue = { name: '', admissionNo: '', admissionClassId: null, address: '', phoneNo: '', email: null, dob: '', fatherName: '', motherName: '' };

export function CreateAdmissionAction({ schoolId }: { schoolId: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const classesQuery = useQuery(orpc.school.listClasses.queryOptions({ input: { schoolId } }));
  return <><Button type="button" size="sm" onClick={() => setOpen(true)}><Plus aria-hidden />New admission</Button>{open ? <AdmissionFormDialog open mode="create" defaultValues={emptyAdmission} classes={(classesQuery.data ?? []).map(({ id, label }) => ({ id, label }))} onOpenChange={setOpen} onSubmit={async (value) => {
    await client.school.createAdmission({ schoolId, ...value });
    await queryClient.invalidateQueries({ queryKey: orpc.school.listAdmissions.queryKey({ input: { schoolId } }) });
  }} /> : null}</>;
}

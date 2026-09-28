'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';

import { orpc } from '@/lib/orpc';

export function AdmissionBreadcrumbValue({ schoolId, admissionId }: { schoolId: string; admissionId: string }) {
  const admissionQuery = useQuery(orpc.school.getAdmission.queryOptions({ input: { schoolId, admissionId } }));
  return <>{admissionQuery.data?.name ?? 'Admission'}</>;
}

export function AdmissionSectionBreadcrumbValue() {
  const pathname = usePathname();
  const section = pathname.split('/').filter(Boolean).at(-1) ?? 'details';
  return <>{section.charAt(0).toUpperCase() + section.slice(1)}</>;
}

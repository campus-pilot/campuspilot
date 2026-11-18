import { UserRoundPlus } from 'lucide-react';
import { CreateAdmissionAction } from '@/components/create-admission-action';
import { defineManagementPage } from '@/components/management-route';
import { schoolPageBreadcrumbs } from '@/components/school-page-breadcrumbs';
import type { SchoolRouteParams } from '@/components/school-route';

export const admissionPage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/admission$/.test(pathname),
  title: 'Admission',
  breadcrumbs: ({ schoolId }) =>
    schoolPageBreadcrumbs(schoolId, { id: 'admission', label: 'Admission', icon: UserRoundPlus }),
  actions: ({ schoolId }) => <CreateAdmissionAction schoolId={schoolId} />,
});

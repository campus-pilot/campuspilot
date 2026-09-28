import { UserRoundPlus } from 'lucide-react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { CreateAdmissionAction } from '@/components/create-admission-action';
import { defineManagementPage } from '@/components/management-route';
import { RequirePermissions } from '@/components/require-permissions';
import { schoolPageBreadcrumbs } from '@/components/school-page-breadcrumbs';
import type { SchoolRouteParams } from '@/components/school-route';

export const admissionPage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/admission$/.test(pathname),
  breadcrumbs: ({ schoolId }) =>
    schoolPageBreadcrumbs(schoolId, { id: 'admission', label: 'Admission', icon: UserRoundPlus }),
  actions: ({ schoolId }) => (
    <RequirePermissions permissions={[
      { action: SCHOOL_ACTIONS.CREATE_ADMISSION, resource: { kind: 'school', schoolId } },
      { action: SCHOOL_ACTIONS.LIST_CLASSES, resource: { kind: 'school', schoolId } },
    ]}>
      <CreateAdmissionAction schoolId={schoolId} />
    </RequirePermissions>
  ),
});

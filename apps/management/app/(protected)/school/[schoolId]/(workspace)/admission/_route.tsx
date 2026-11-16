import { UserRoundPlus } from 'lucide-react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { CreateAdmissionAction } from '@/components/create-admission-action';
import { defineManagementPage } from '@/components/management-route';
import { RequireFeature } from '@/components/require-feature';
import { RequirePermissions } from '@/components/require-permissions';
import { schoolPageBreadcrumbs } from '@/components/school-page-breadcrumbs';
import type { SchoolRouteParams } from '@/components/school-route';

export const admissionPage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/admission$/.test(pathname),
  title: 'Admission',
  breadcrumbs: ({ schoolId }) =>
    schoolPageBreadcrumbs(schoolId, { id: 'admission', label: 'Admission', icon: UserRoundPlus }),
  // A feature and a permission are separate gates; the action needs both.
  actions: ({ schoolId }) => (
    <RequireFeature schoolId={schoolId} feature="studentManagement">
      <RequirePermissions permissions={[
        { action: SCHOOL_ACTIONS.CREATE_ADMISSION, resource: { kind: 'school', schoolId } },
        { action: SCHOOL_ACTIONS.LIST_CLASSES, resource: { kind: 'school', schoolId } },
      ]}>
        <CreateAdmissionAction schoolId={schoolId} />
      </RequirePermissions>
    </RequireFeature>
  ),
});

import { UserRound } from 'lucide-react';
import { AdmissionBreadcrumbValue, AdmissionSectionBreadcrumbValue } from '@/components/admission-breadcrumb-values';
import { defineManagementPage } from '@/components/management-route';
import { schoolPageBreadcrumbs } from '@/components/school-page-breadcrumbs';
import { schoolHref } from '@/components/school-route';

type AdmissionRouteParams = { schoolId: string; admissionId: string };

export const admissionDetailsPage = defineManagementPage<AdmissionRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/admission\/[^/]+(?:\/.*)?$/.test(pathname),
  breadcrumbs: ({ schoolId, admissionId }) => [
    ...schoolPageBreadcrumbs(schoolId, { id: 'admission', label: 'Admission', icon: UserRound }).map((breadcrumb) => breadcrumb.id === 'admission' ? { ...breadcrumb, href: schoolHref(schoolId, '/admission') } : breadcrumb),
    { id: 'admission-name', label: <AdmissionBreadcrumbValue schoolId={schoolId} admissionId={admissionId} />, href: schoolHref(schoolId, `/admission/${encodeURIComponent(admissionId)}/details`), icon: UserRound },
    { id: 'admission-section', label: <AdmissionSectionBreadcrumbValue /> },
  ],
});

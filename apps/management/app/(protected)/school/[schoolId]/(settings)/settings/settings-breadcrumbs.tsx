import type { AppShellBreadcrumb, AppShellIcon } from '@campuspilot/components/app-shell';
import { Settings } from 'lucide-react';
import { schoolPageBreadcrumbs } from '@/components/school-page-breadcrumbs';
import { schoolHref } from '@/components/school-route';

export function settingsBreadcrumbs(
  schoolId: string,
  leaf: { id: string; label: string; icon: AppShellIcon },
): AppShellBreadcrumb[] {
  return [
    ...schoolPageBreadcrumbs(schoolId, {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
    }),
    { ...leaf, href: undefined },
  ].map((breadcrumb) =>
    breadcrumb.id === 'settings'
      ? { ...breadcrumb, href: schoolHref(schoolId, '/settings') }
      : breadcrumb,
  );
}


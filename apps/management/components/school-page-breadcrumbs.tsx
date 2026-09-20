import type { AppShellBreadcrumb, AppShellIcon } from '@campuspilot/components/app-shell';
import { House } from 'lucide-react';
import { schoolHref } from './school-route';

/** Builds a school-home root while leaving each following crumb owned by its route. */
export function schoolPageBreadcrumbs(
  schoolId: string,
  leaf?: { id: string; label: string; icon: AppShellIcon },
): AppShellBreadcrumb[] {
  const breadcrumbs: AppShellBreadcrumb[] = [
    {
      id: 'school-home',
      label: <span className="sr-only">Home</span>,
      href: leaf ? schoolHref(schoolId) : undefined,
      icon: House,
    },
  ];

  if (leaf) breadcrumbs.push(leaf);
  return breadcrumbs;
}

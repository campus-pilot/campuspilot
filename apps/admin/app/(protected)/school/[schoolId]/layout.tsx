'use client';

import type { ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import type { AppShellNavigationEntry } from '@campuspilot/components/app-shell';
import {
  CalendarDays,
  Database,
  Flag,
  GraduationCap,
  LayoutDashboard,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import { AdminShell, type AdminShellState } from '@/components/admin-shell';
import { resolveAdminPageActions } from '@/components/admin-route';
import { dashboardPage } from './_route';
import { sessionsPage } from './sessions/_route';
import { settingsPage } from './settings/_route';
import { staffPage } from './staff/_route';
import { studentsPage } from './students/_route';
import { aiUsagePage } from './usage/ai/_route';
import { featureFlagsPage } from './usage/feature-flags/_route';
import { storageUsagePage } from './usage/storage/_route';
import { schoolHref, type SchoolRouteParams } from './school-route';

const pages = [
  dashboardPage,
  sessionsPage,
  staffPage,
  studentsPage,
  aiUsagePage,
  storageUsagePage,
  featureFlagsPage,
  settingsPage,
];

function navigationFor(schoolId: string): AppShellNavigationEntry[] {
  return [
    {
      type: 'group',
      id: 'general',
      label: 'General',
      items: [
        {
          type: 'item',
          id: 'dashboard',
          label: 'Dashboard',
          href: schoolHref(schoolId),
          icon: LayoutDashboard,
          match: 'exact',
        },
        {
          type: 'item',
          id: 'sessions',
          label: 'Sessions',
          href: schoolHref(schoolId, '/sessions'),
          icon: CalendarDays,
        },
        {
          type: 'item',
          id: 'staff',
          label: 'Staff',
          href: schoolHref(schoolId, '/staff'),
          icon: Users,
        },
        {
          type: 'item',
          id: 'students',
          label: 'Students',
          href: schoolHref(schoolId, '/students'),
          icon: GraduationCap,
        },
      ],
    },
    {
      type: 'group',
      id: 'usage',
      label: 'Usage',
      items: [
        {
          type: 'item',
          id: 'ai-usage',
          label: 'AI',
          href: schoolHref(schoolId, '/usage/ai'),
          icon: Sparkles,
        },
        {
          type: 'item',
          id: 'storage-usage',
          label: 'Storage',
          href: schoolHref(schoolId, '/usage/storage'),
          icon: Database,
        },
        {
          type: 'item',
          id: 'feature-flags',
          label: 'Feature Flags',
          href: schoolHref(schoolId, '/usage/feature-flags'),
          icon: Flag,
        },
      ],
    },
    {
      type: 'item',
      id: 'settings',
      label: 'Settings',
      href: schoolHref(schoolId, '/settings'),
      icon: Settings,
    },
  ];
}

export default function SchoolLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { schoolId } = useParams<SchoolRouteParams>();
  const page = pages.find((candidate) => candidate.matches(pathname));
  const params = { schoolId };
  const state: AdminShellState = {
    navigation: navigationFor(schoolId),
    breadcrumbs: page?.breadcrumbs(params) ?? [],
    navbarActions: resolveAdminPageActions(page, params),
  };

  return <AdminShell state={state}>{children}</AdminShell>;
}

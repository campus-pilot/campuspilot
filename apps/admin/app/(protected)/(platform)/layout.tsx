'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { AppShellNavigationEntry } from '@campuspilot/components/app-shell';
import {
  Building2,
  ChartNoAxesColumn,
  ClipboardList,
  DatabaseZap,
  House,
  KeyRound,
} from 'lucide-react';
import { AdminShell, type AdminShellState } from '@/components/admin-shell';
import { resolveAdminPageActions } from '@/components/admin-route';
import { NewSchoolAction } from '@/components/new-school-action';
import { DemoPurgeAlerts } from '@/components/demo-school/demo-purge-alerts';
import { dataMigrationsPage } from './data-migrations/_route';
import { demoRequestsPage } from './demo-requests/_route';
import { homePage } from './_route';
import { oauthClientsPage } from './oauth-clients/_route';
import { organizationsPage } from './organizations/_route';
import { platformUsagePage } from './platform-usage/_route';

const navigation: AppShellNavigationEntry[] = [
  {
    type: 'group',
    id: 'general',
    label: 'General',
    items: [
      { type: 'item', id: 'home', label: 'Home', href: '/', icon: House, match: 'exact' },
      {
        type: 'item',
        id: 'demo-requests',
        label: 'Demo requests',
        href: '/demo-requests',
        icon: ClipboardList,
      },
    ],
  },
  {
    type: 'group',
    id: 'administration',
    label: 'Administration',
    items: [
      {
        type: 'item',
        id: 'organizations',
        label: 'Organizations',
        href: '/organizations',
        icon: Building2,
      },
      {
        type: 'item',
        id: 'oauth-clients',
        label: 'OAuth clients',
        href: '/oauth-clients',
        icon: KeyRound,
      },
      {
        type: 'item',
        id: 'platform-usage',
        label: 'Platform Usage',
        href: '/platform-usage',
        icon: ChartNoAxesColumn,
      },
      {
        type: 'item',
        id: 'data-migrations',
        label: 'Data migrations',
        href: '/data-migrations',
        icon: DatabaseZap,
      },
    ],
  },
];

const pages = [
  homePage,
  demoRequestsPage,
  organizationsPage,
  oauthClientsPage,
  platformUsagePage,
  dataMigrationsPage,
];

export default function PlatformLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const page = pages.find((candidate) => candidate.matches(pathname));
  const params = {};
  const state: AdminShellState = {
    navigation,
    breadcrumbs: page?.breadcrumbs(params) ?? [],
    navbarActions: resolveAdminPageActions(page, params, <NewSchoolAction />),
  };

  return (
    <AdminShell state={state}>
      <DemoPurgeAlerts />
      {children}
    </AdminShell>
  );
}

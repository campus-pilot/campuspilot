'use client';

import type { ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import type { AppShellNavigationEntry } from '@campuspilot/components/app-shell';
import {
  Bell,
  ClipboardCheck,
  CreditCard,
  GraduationCap,
  LayoutDashboard,
  Settings,
  UserRoundPlus,
  Users,
  WalletCards,
} from 'lucide-react';
import {
  ManagementShell,
  type ManagementShellState,
} from '@/components/management-shell';
import { resolveManagementPageActions } from '@/components/management-route';
import { schoolHref, type SchoolRouteParams } from '@/components/school-route';
import { admissionsPage } from './admissions/_route';
import { billingPage } from './billing/_route';
import { classroomPage } from './classroom/_route';
import { dashboardPage } from './_route';
import { examPage } from './exam/_route';
import { financePage } from './finance/_route';
import { noticesPage } from './notices/_route';
import { staffPage } from './staff/_route';

const pages = [
  dashboardPage,
  staffPage,
  noticesPage,
  admissionsPage,
  classroomPage,
  examPage,
  financePage,
  billingPage,
];

function navigationFor(schoolId: string): AppShellNavigationEntry[] {
  return [
    {
      type: 'item',
      id: 'dashboard',
      label: 'Dashboard',
      href: schoolHref(schoolId),
      icon: LayoutDashboard,
      match: 'exact',
    },
    {
      type: 'group',
      id: 'management',
      label: 'Management',
      items: [
        {
          type: 'item',
          id: 'staff',
          label: 'Staff',
          href: schoolHref(schoolId, '/staff'),
          icon: Users,
        },
        {
          type: 'item',
          id: 'notices',
          label: 'Notices',
          href: schoolHref(schoolId, '/notices'),
          icon: Bell,
        },
      ],
    },
    {
      type: 'group',
      id: 'student',
      label: 'Student',
      items: [
        {
          type: 'item',
          id: 'admissions',
          label: 'Admissions',
          href: schoolHref(schoolId, '/admissions'),
          icon: UserRoundPlus,
        },
        {
          type: 'item',
          id: 'classroom',
          label: 'Classroom',
          href: schoolHref(schoolId, '/classroom'),
          icon: GraduationCap,
        },
      ],
    },
    {
      type: 'item',
      id: 'exam',
      label: 'Exam',
      href: schoolHref(schoolId, '/exam'),
      icon: ClipboardCheck,
    },
    {
      type: 'group',
      id: 'finance-and-billing',
      label: 'Finance and Billing',
      items: [
        {
          type: 'item',
          id: 'finance',
          label: 'Finance',
          href: schoolHref(schoolId, '/finance'),
          icon: WalletCards,
        },
        {
          type: 'item',
          id: 'billing',
          label: 'Billing',
          href: schoolHref(schoolId, '/billing'),
          icon: CreditCard,
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

export default function SchoolWorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const routeParams = useParams();
  const schoolId = String(routeParams.schoolId ?? '');
  const page = pages.find((candidate) => candidate.matches(pathname));
  const params: SchoolRouteParams = { schoolId };
  const state: ManagementShellState = {
    navigation: navigationFor(schoolId),
    breadcrumbs: page?.breadcrumbs(params) ?? [],
    navbarActions: resolveManagementPageActions(page, params),
  };

  return <ManagementShell state={state}>{children}</ManagementShell>;
}

'use client';

import type { ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { AppShellNavigationEntry } from '@campuspilot/components/app-shell';
import {
  ArrowLeft,
  BookOpenCheck,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  CreditCard,
  FileBadge,
  GraduationCap,
  ReceiptText,
  School,
  Settings,
} from 'lucide-react';
import {
  ManagementShell,
  type ManagementShellState,
} from '@/components/management-shell';
import { resolveManagementPageActions } from '@/components/management-route';
import { schoolHref, type SchoolRouteParams } from '@/components/school-route';
import { orpc } from '@/lib/orpc';
import { schoolSettingsPage } from './_route';
import { sessionSettingsPage } from './session/_route';
import { admitCardTemplatePage } from './templates/admit-card/_route';
import { billTemplatePage } from './templates/bill/_route';
import { examinationTemplatePage } from './templates/examination/_route';
import { idCardTemplatePage } from './templates/id-card/_route';
import { noticeTemplatePage } from './templates/notice/_route';
import { receiptTemplatePage } from './templates/receipt/_route';
import { timetableTemplatePage } from './templates/timetable/_route';

const pages = [
  schoolSettingsPage,
  sessionSettingsPage,
  examinationTemplatePage,
  idCardTemplatePage,
  admitCardTemplatePage,
  timetableTemplatePage,
  billTemplatePage,
  receiptTemplatePage,
  noticeTemplatePage,
];

function navigationFor(
  schoolId: string,
  canViewSessions: boolean,
): AppShellNavigationEntry[] {
  return [
    {
      type: 'item',
      id: 'school-settings',
      label: 'School',
      href: schoolHref(schoolId, '/settings'),
      icon: School,
      match: 'exact',
    },
    ...(canViewSessions ? [{
      type: 'item',
      id: 'session-settings',
      label: 'Session',
      href: schoolHref(schoolId, '/settings/session'),
      icon: CalendarDays,
    } satisfies AppShellNavigationEntry] : []),
    {
      type: 'item',
      id: 'templates',
      label: 'Templates',
      href: schoolHref(schoolId, '/settings/templates/examination'),
      icon: Settings,
      items: [
        {
          type: 'item',
          id: 'examination-template',
          label: 'Examination',
          href: schoolHref(schoolId, '/settings/templates/examination'),
          icon: ClipboardCheck,
        },
        {
          type: 'item',
          id: 'id-card-template',
          label: 'ID card',
          href: schoolHref(schoolId, '/settings/templates/id-card'),
          icon: FileBadge,
        },
        {
          type: 'item',
          id: 'admit-card-template',
          label: 'Admit card',
          href: schoolHref(schoolId, '/settings/templates/admit-card'),
          icon: GraduationCap,
        },
        {
          type: 'item',
          id: 'timetable-template',
          label: 'Timetable',
          href: schoolHref(schoolId, '/settings/templates/timetable'),
          icon: CalendarRange,
        },
        {
          type: 'item',
          id: 'bill-template',
          label: 'Bill',
          href: schoolHref(schoolId, '/settings/templates/bill'),
          icon: CreditCard,
        },
        {
          type: 'item',
          id: 'receipt-template',
          label: 'Receipt',
          href: schoolHref(schoolId, '/settings/templates/receipt'),
          icon: ReceiptText,
        },
        {
          type: 'item',
          id: 'notice-template',
          label: 'Notice',
          href: schoolHref(schoolId, '/settings/templates/notice'),
          icon: BookOpenCheck,
        },
      ],
    },
  ];
}

export default function SchoolSettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const routeParams = useParams();
  const schoolId = String(routeParams.schoolId ?? '');
  const page = pages.find((candidate) => candidate.matches(pathname));
  const params: SchoolRouteParams = { schoolId };
  const sessionPermissionQuery = useQuery(
    orpc.authorization.checkPermissions.queryOptions({
      input: {
        permissions: [
          {
            action: SCHOOL_ACTIONS.LIST_SESSIONS,
            resource: { kind: 'school', schoolId },
          },
        ],
      },
    }),
  );
  const state: ManagementShellState = {
    navigation: navigationFor(
      schoolId,
      sessionPermissionQuery.data?.results[0] === true,
    ),
    breadcrumbs: page?.breadcrumbs(params) ?? [],
    footerLinks: [
      {
        id: 'back-to-dashboard',
        label: 'Back to dashboard',
        href: schoolHref(schoolId),
        icon: ArrowLeft,
      },
    ],
    navbarActions: resolveManagementPageActions(page, params),
  };

  return (
    <ManagementShell state={state} showSearch={false}>
      {children}
    </ManagementShell>
  );
}

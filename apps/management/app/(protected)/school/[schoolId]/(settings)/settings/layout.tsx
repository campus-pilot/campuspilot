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
  Files,
  GraduationCap,
  ReceiptText,
  School,
  ScrollText,
  Settings,
} from 'lucide-react';
import {
  ManagementShell,
  type ManagementShellState,
} from '@/components/management-shell';
import {
  resolveManagementPageActions,
  type ManagementPageDescriptor,
} from '@/components/management-route';
import {
  schoolHref,
  schoolSessionHref,
  type SchoolRouteParams,
} from '@/components/school-route';
import {
  useSchoolSessions,
  useStoredSchoolSessionId,
} from '@/components/session-selection';
import { SessionSwitcher } from '@/components/session-switcher';
import { orpc } from '@/lib/orpc';
import { RequirePermissions } from '@/components/require-permissions';
import { schoolSettingsPage } from './_route';
import { documentSettingsPage } from './documents/_route';
import { sessionSettingsPage } from './session/_route';
import { sessionDetailPage } from './session/[sessionId]/_route';
import { admitCardTemplatePage } from './templates/admit-card/_route';
import { billTemplatePage } from './templates/bill/_route';
import { examinationTemplatePage } from './templates/examination/_route';
import { idCardTemplatePage } from './templates/id-card/_route';
import { noticeTemplatePage } from './templates/notice/_route';
import { receiptTemplatePage } from './templates/receipt/_route';
import { timetableTemplatePage } from './templates/timetable/_route';
import { statementTemplatePage } from './templates/statement/_route';

type SettingsRouteParams = SchoolRouteParams & { sessionId: string };

const pages: ManagementPageDescriptor<SettingsRouteParams>[] = [
  schoolSettingsPage,
  documentSettingsPage,
  sessionDetailPage,
  sessionSettingsPage,
  examinationTemplatePage,
  idCardTemplatePage,
  admitCardTemplatePage,
  timetableTemplatePage,
  billTemplatePage,
  receiptTemplatePage,
  statementTemplatePage,
  noticeTemplatePage,
];

function navigationFor(
  schoolId: string,
  canViewSessions: boolean,
  activeSessionId?: string,
): AppShellNavigationEntry[] {
  const withTemplatePermission = (children: ReactNode) => (
    <RequirePermissions
      permissions={{
        action: SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES,
        resource: { kind: 'school', schoolId },
      }}
    >
      {children}
    </RequirePermissions>
  );
  const withFinanceTemplatePermission = (children: ReactNode) => (
    <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES, resource: { kind: 'school', schoolId } }}>
      {children}
    </RequirePermissions>
  );
  return [
    {
      type: 'item',
      id: 'school-settings',
      label: 'School',
      href: schoolHref(schoolId, '/settings'),
      icon: School,
      match: 'exact',
    },
    {
      type: 'item',
      id: 'admission-documents',
      label: 'Documents',
      href: schoolHref(schoolId, '/settings/documents'),
      icon: Files,
    },
    ...(canViewSessions
      ? [
          {
            type: 'item',
            id: 'session-settings',
            label: 'Sessions',
            href: activeSessionId
              ? schoolHref(schoolId, `/settings/session/${activeSessionId}`)
              : schoolHref(schoolId, '/settings/session'),
            icon: CalendarDays,
            isActive: (currentPath) =>
              currentPath === schoolHref(schoolId, '/settings/session') ||
              currentPath.startsWith(
                schoolHref(schoolId, '/settings/session/'),
              ),
          } satisfies AppShellNavigationEntry,
        ]
      : []),
    {
      type: 'item',
      id: 'templates',
      wrap: withTemplatePermission,
      label: 'Templates',
      href: schoolHref(schoolId, '/settings/templates/examination'),
      icon: Settings,
      items: [
        {
          type: 'item',
          id: 'examination-template',
          wrap: withTemplatePermission,
          label: 'Examination',
          href: schoolHref(schoolId, '/settings/templates/examination'),
          icon: ClipboardCheck,
        },
        {
          type: 'item',
          id: 'id-card-template',
          wrap: withTemplatePermission,
          label: 'ID card',
          href: schoolHref(schoolId, '/settings/templates/id-card'),
          icon: FileBadge,
        },
        {
          type: 'item',
          id: 'admit-card-template',
          wrap: withTemplatePermission,
          label: 'Admit card',
          href: schoolHref(schoolId, '/settings/templates/admit-card'),
          icon: GraduationCap,
        },
        {
          type: 'item',
          id: 'timetable-template',
          wrap: withTemplatePermission,
          label: 'Timetable',
          href: schoolHref(schoolId, '/settings/templates/timetable'),
          icon: CalendarRange,
        },
        {
          type: 'item',
          id: 'bill-template',
          wrap: withFinanceTemplatePermission,
          label: 'Bill',
          href: schoolHref(schoolId, '/settings/templates/bill'),
          icon: CreditCard,
        },
        {
          type: 'item',
          id: 'receipt-template',
          wrap: withFinanceTemplatePermission,
          label: 'Receipt',
          href: schoolHref(schoolId, '/settings/templates/receipt'),
          icon: ReceiptText,
        },
        {
          type: 'item',
          id: 'statement-template',
          wrap: withFinanceTemplatePermission,
          label: 'Statement',
          href: schoolHref(schoolId, '/settings/templates/statement'),
          icon: ScrollText,
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
  const storedSessionId = useStoredSchoolSessionId(schoolId);
  const page = pages.find((candidate) => candidate.matches(pathname));
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
  const sessionsQuery = useSchoolSessions(
    schoolId,
    sessionPermissionQuery.data?.results[0] === true,
  );
  const sessions = sessionsQuery.data ?? [];
  const activeSessionId = sessions.find((session) => session.isActive)?.id;
  const selectedSessionId = storedSessionId ?? activeSessionId;
  const params = {
    schoolId,
    sessionId: String(routeParams.sessionId ?? ''),
  };
  const state: ManagementShellState = {
    navigation: navigationFor(
      schoolId,
      sessionPermissionQuery.data?.results[0] === true,
      activeSessionId,
    ),
    breadcrumbs: page?.breadcrumbs(params) ?? [],
    footerContent: (
      <SessionSwitcher
        schoolId={schoolId}
        selectedSessionId={selectedSessionId}
        sessions={sessions}
      />
    ),
    footerLinks: [
      {
        id: 'back-to-dashboard',
        label: 'Back to dashboard',
        href: selectedSessionId
          ? schoolSessionHref(schoolId, selectedSessionId)
          : schoolHref(schoolId),
        icon: ArrowLeft,
      },
    ],
    navbarActions: resolveManagementPageActions(page, params),
  };

  return <ManagementShell state={state}>{children}</ManagementShell>;
}

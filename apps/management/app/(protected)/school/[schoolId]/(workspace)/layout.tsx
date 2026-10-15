'use client';

import type { ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
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
} from 'lucide-react';
import {
  ManagementShell,
  type ManagementShellState,
} from '@/components/management-shell';
import { resolveManagementPageActions } from '@/components/management-route';
import type { ManagementPageDescriptor } from '@/components/management-route';
import {
  schoolHref,
  schoolSessionHref,
  type SchoolSessionRouteParams,
} from '@/components/school-route';
import {
  PersistSchoolSessionSelection,
  useSchoolSessions,
  useStoredSchoolSessionId,
} from '@/components/session-selection';
import { SessionSwitcher } from '@/components/session-switcher';
import { admissionPage } from './admission/_route';
import { admissionDetailsPage } from './admission/[admissionId]/_route';
import { billingPage } from './sessions/[sessionId]/billing/_route';
import {
  classroomDetailsPage,
  classStudentDetailsPage,
  classStudentsPage,
  classroomPage,
} from './sessions/[sessionId]/classroom/_route';
import { dashboardPage } from './sessions/[sessionId]/_route';
import { examPage } from './sessions/[sessionId]/exam/_route';
import { noticesPage } from './sessions/[sessionId]/notices/_route';
import { staffPage } from './staff/_route';

const pages: ManagementPageDescriptor<any>[] = [
  dashboardPage,
  staffPage,
  noticesPage,
  admissionPage,
  admissionDetailsPage,
  classroomPage,
  classStudentDetailsPage,
  classStudentsPage,
  classroomDetailsPage,
  examPage,
  billingPage,
];

function navigationFor(
  schoolId: string,
  sessionId?: string,
): AppShellNavigationEntry[] {
  const sessionHref = (suffix = '') =>
    sessionId
      ? schoolSessionHref(schoolId, sessionId, suffix)
      : schoolHref(schoolId);

  return [
    {
      type: 'item',
      id: 'dashboard',
      label: 'Dashboard',
      href: sessionHref(),
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
          id: 'admission',
          label: 'Admission',
          href: schoolHref(schoolId, '/admission'),
          icon: UserRoundPlus,
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
          id: 'classroom',
          label: 'Classroom',
          href: sessionHref('/classroom'),
          icon: GraduationCap,
        },
        {
          type: 'item',
          id: 'exam',
          label: 'Examinations',
          wrap: children => <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.READ_EXAMS, resource: { kind: 'school', schoolId } }}>{children}</RequirePermissions>,
          href: sessionHref('/exam'),
          icon: ClipboardCheck,
        },
      ],
    },
    {
      type: 'group',
      id: 'operations',
      label: 'Operations',
      items: [
        {
          type: 'item',
          id: 'billing',
          label: 'Billing',
          href: sessionHref('/billing'),
          icon: CreditCard,
        },
        {
          type: 'item',
          id: 'notices',
          label: 'Notices',
          href: sessionHref('/notices'),
          icon: Bell,
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
  const routeSessionId = String(routeParams.sessionId ?? '') || undefined;
  const storedSessionId = useStoredSchoolSessionId(schoolId);
  const sessionsQuery = useSchoolSessions(schoolId);
  const sessions = sessionsQuery.data ?? [];
  const activeSessionId = sessions.find((session) => session.isActive)?.id;
  const selectedSessionId =
    routeSessionId ?? storedSessionId ?? activeSessionId;
  const page = pages.find((candidate) => candidate.matches(pathname));
  const params = {
    ...routeParams,
    schoolId,
    sessionId: routeSessionId ?? selectedSessionId ?? '',
  } as SchoolSessionRouteParams & Record<string, string>;
  const state: ManagementShellState = {
    navigation: navigationFor(schoolId, selectedSessionId),
    breadcrumbs: page?.breadcrumbs(params) ?? [],
    footerContent: (
      <SessionSwitcher
        schoolId={schoolId}
        selectedSessionId={selectedSessionId}
        sessions={sessions}
      />
    ),
    navbarActions: resolveManagementPageActions(page, params),
  };

  const shell = <ManagementShell state={state}>{children}</ManagementShell>;
  return routeSessionId ? (
    <PersistSchoolSessionSelection
      schoolId={schoolId}
      sessionId={routeSessionId}
    >
      {shell}
    </PersistSchoolSessionSelection>
  ) : (
    shell
  );
}

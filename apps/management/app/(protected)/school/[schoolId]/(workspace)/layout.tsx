'use client';

import type { ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { SCHOOL_ACTIONS, type PermissionCheck } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequireFeature, useSchoolFeatureCheck } from '@/components/require-feature';
import type { SchoolFeatureKey } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import { RequirePermissions } from '@/components/require-permissions';
import type { AppShellNavigationDisclosure, AppShellNavigationEntry, AppShellNavigationItem } from '@campuspilot/components/app-shell';
import {
  Files,
  ClipboardCheck,
  CreditCard,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  NotebookPen,
  Settings,
  Sparkles,
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
import { SchoolDocumentHead } from '@/components/school-document-head';
import { RealSchoolOnly } from '@/components/personal-space/school-kind-gates';
import { SessionSwitcher } from '@/components/session-switcher';
import { AssistantAccess } from '@/components/assistant/assistant-access';
import { isQuestionPaperSectionPath } from '@/components/exam/exam-model';
import { QuestionPaperNav } from '@/components/question-paper/question-paper-nav';
import { admissionPage } from './admission/_route';
import { assistantPage } from './assistant/_route';
import { admissionDetailsPage } from './admission/[admissionId]/_route';
import { billingPages, billingRunDetailPage } from './sessions/[sessionId]/billing/_route';
import {
  classroomDetailsPage,
  classStudentDetailsPage,
  classStudentsPage,
  classroomPage,
} from './sessions/[sessionId]/classroom/_route';
import { dashboardPage } from './sessions/[sessionId]/_route';
import { examPage, examDetailsPage, questionPaperPages } from './sessions/[sessionId]/exam/_route';
import { noticePages } from './sessions/[sessionId]/notices/_route';
import { notificationsPage } from './notifications/_route';
import { staffPage } from './staff/_route';

import { documentPages } from './sessions/[sessionId]/documents/_route';
import { templateMarketplacePages } from './marketplace/templates/_route';

const pages: ManagementPageDescriptor<any>[] = [
  ...templateMarketplacePages,
  ...documentPages,
  assistantPage,
  dashboardPage,
  staffPage,
  notificationsPage,
  ...noticePages,
  admissionPage,
  admissionDetailsPage,
  classroomPage,
  classStudentDetailsPage,
  classStudentsPage,
  classroomDetailsPage,
  examPage,
  // Before examDetailsPage, which matches every path below an exam.
  ...questionPaperPages,
  examDetailsPage,
  ...billingPages,
  billingRunDetailPage,
];

/**
 * The workspace navigation. `has` answers whether the school is known to have
 * a feature (unknown counts as no, like every feature check).
 */
function navigationFor(
  schoolId: string,
  has: (feature: SchoolFeatureKey) => boolean,
  sessionId?: string,
): AppShellNavigationEntry[] {
  const sessionHref = (suffix = '') =>
    sessionId
      ? schoolSessionHref(schoolId, sessionId, suffix)
      : schoolHref(schoolId);
  const schoolPermissions = (mode: 'any' | 'all', actions: readonly (typeof SCHOOL_ACTIONS)[keyof typeof SCHOOL_ACTIONS][]) =>
    (children: ReactNode) => (
      <RequirePermissions mode={mode} permissions={actions.map((action) => ({ action, resource: { kind: 'school', schoolId } }) as PermissionCheck)}>
        {children}
      </RequirePermissions>
    );
  /** The Operations items, each with the feature it belongs to. */
  const operations: { feature: SchoolFeatureKey; item: AppShellNavigationItem }[] = [
    {
      feature: 'studentManagement',
      item: {
        type: 'item',
        id: 'documents',
        label: 'Documents',
        href: sessionHref('/documents'),
        icon: Files,
        wrap: schoolPermissions('any', [SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES, SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES, SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS, SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_ARTIFACTS]),
      },
    },
    {
      feature: 'studentManagement',
      item: {
        type: 'item',
        id: 'billing',
        label: 'Billing',
        href: sessionHref('/billing'),
        icon: CreditCard,
        wrap: schoolPermissions('any', [SCHOOL_ACTIONS.READ_BILLING_REPORTS, SCHOOL_ACTIONS.READ_BILLING_RUNS, SCHOOL_ACTIONS.READ_ADMISSION_LEDGER]),
      },
    },
    {
      feature: 'notices',
      item: {
        type: 'item',
        id: 'notices',
        label: 'Notices',
        href: sessionHref('/notices'),
        icon: Megaphone,
        wrap: schoolPermissions('all', [SCHOOL_ACTIONS.READ_NOTICE]),
      },
    },
  ];

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
      type: 'item',
      id: 'assistant',
      label: 'Assistant',
      href: schoolHref(schoolId, '/assistant'),
      icon: Sparkles,
      wrap: (children) => <AssistantAccess schoolId={schoolId}>{children}</AssistantAccess>,
    },
    {
      type: 'group',
      id: 'campus',
      label: 'Campus',
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
          wrap: (children) => <RequireFeature schoolId={schoolId} feature="studentManagement">{children}</RequireFeature>,
        },
      ],
    },
    {
      type: 'group',
      id: 'academics',
      label: 'Academics',
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
          // The Question paper section highlights its own entry below instead.
          isActive: (path) =>
            (path === sessionHref('/exam') || path.startsWith(`${sessionHref('/exam')}/`)) &&
            !(sessionId && isQuestionPaperSectionPath(path, sessionHref())),
        },
        ...(sessionId ? [questionPapersEntry(schoolId, sessionId, sessionHref())] : []),
      ],
    },
    // Shown when the school has at least one of its items' features, so the
    // label is never left over an empty group. Each item is gated on its own
    // feature below (and on its own permission).
    ...(operations.some(({ feature }) => has(feature))
      ? [
          {
            type: 'group',
            id: 'operations',
            label: 'Operations',
            items: operations.map(({ feature, item }) => ({
              ...item,
              // A feature and a permission are separate gates; the item needs both.
              wrap: (children: ReactNode) => (
                <RequireFeature schoolId={schoolId} feature={feature}>
                  {item.wrap ? item.wrap(children) : children}
                </RequireFeature>
              ),
            })),
          } satisfies AppShellNavigationEntry,
        ]
      : []),
  ];
}

/**
 * The sidebar's Question papers entry: it opens in place to the session's
 * examinations and then their classes (`QuestionPaperNav`), a fold rather
 * than popovers so the same steps work in the desktop sidebar and the mobile
 * sheet. Left out without a selected session. Its gates are separate facts,
 * each checked on its own: `READ_EXAMS` (as Examinations), `READ_EXAM_PLANS`
 * (what the Question paper tab needs) and the assistant (question papers are
 * part of the `assistant` feature, so the entry shows only where the tab does).
 */
function questionPapersEntry(schoolId: string, sessionId: string, sessionBase: string): AppShellNavigationDisclosure {
  return {
    type: 'disclosure',
    id: 'question-papers',
    label: 'Question papers',
    icon: NotebookPen,
    isActive: (path) => isQuestionPaperSectionPath(path, sessionBase),
    content: <QuestionPaperNav schoolId={schoolId} sessionId={sessionId} />,
    wrap: (children) => (
      <RequirePermissions
        permissions={[SCHOOL_ACTIONS.READ_EXAMS, SCHOOL_ACTIONS.READ_EXAM_PLANS].map(
          (action) => ({ action, resource: { kind: 'school', schoolId } }) as PermissionCheck,
        )}
      >
        <AssistantAccess schoolId={schoolId}>{children}</AssistantAccess>
      </RequirePermissions>
    ),
  };
}

/**
 * The school workspace. A personal space has none (docs/personal-space.md):
 * its addresses here open its papers (`RealSchoolOnly`), before any workspace
 * page asks for a session or a class.
 */
export default function SchoolWorkspaceLayout({ children }: { children: ReactNode }) {
  const routeParams = useParams();
  const schoolId = String(routeParams.schoolId ?? '');
  return (
    <RealSchoolOnly schoolId={schoolId}>
      <SchoolWorkspaceShell>{children}</SchoolWorkspaceShell>
    </RealSchoolOnly>
  );
}

function SchoolWorkspaceShell({
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
  const hasFeature = useSchoolFeatureCheck(schoolId);
  const params = {
    ...routeParams,
    schoolId,
    sessionId: routeSessionId ?? selectedSessionId ?? '',
  } as SchoolSessionRouteParams & Record<string, string>;
  const state: ManagementShellState = {
    commandContext: {
      schoolId,
      sessionId: selectedSessionId,
      sessions,
    },
    navigation: navigationFor(schoolId, hasFeature, selectedSessionId),
    breadcrumbs: page?.breadcrumbs(params) ?? [],
    footerContent: (
      <SessionSwitcher
        schoolId={schoolId}
        selectedSessionId={selectedSessionId}
        sessions={sessions}
        hasNoSessions={sessionsQuery.isSuccess && sessions.length === 0}
      />
    ),
    footerLinks: [
      {
        id: 'settings',
        label: 'Settings',
        href: schoolHref(schoolId, '/settings'),
        icon: Settings,
      },
    ],
    navbarActions: resolveManagementPageActions(page, params),
  };

  const shell = (
    <>
      <SchoolDocumentHead schoolId={schoolId} pageTitle={page?.title} />
      <ManagementShell state={state}>{children}</ManagementShell>
    </>
  );
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

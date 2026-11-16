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
  ChartNoAxesColumn,
  CalendarRange,
  ClipboardCheck,
  CreditCard,
  FileBadge,
  FileQuestionMark,
  Files,
  GraduationCap,
  ReceiptText,
  School,
  ScrollText,
  Settings,
  Sparkles,
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
import { SchoolDocumentHead } from '@/components/school-document-head';
import { SessionSwitcher } from '@/components/session-switcher';
import { orpc } from '@/lib/orpc';
import { RequireFeature, useSchoolFeature } from '@/components/require-feature';
import { RequirePermissions } from '@/components/require-permissions';
import { schoolSettingsPage } from './_route';
import { assistantSettingsPage } from './assistant/_route';
import { usageSettingsPage } from './usage/_route';
import { documentSettingsPage } from './documents/_route';
import { sessionSettingsPage } from './session/_route';
import { sessionDetailPage } from './session/[sessionId]/_route';
import { admitCardTemplatePage } from './templates/admit-card/_route';
import { billTemplatePage } from './templates/bill/_route';
import { examinationTemplatePage } from './templates/examination/_route';
import { idCardTemplatePage } from './templates/id-card/_route';
import { noticeTemplatePage } from './templates/notice/_route';
import { questionPaperTemplatePage } from './templates/question-paper/_route';
import { receiptTemplatePage } from './templates/receipt/_route';
import { timetableTemplatePage } from './templates/timetable/_route';
import { statementTemplatePage } from './templates/statement/_route';

type SettingsRouteParams = SchoolRouteParams & { sessionId: string };

const pages: ManagementPageDescriptor<SettingsRouteParams>[] = [
  schoolSettingsPage,
  documentSettingsPage,
  assistantSettingsPage,
  usageSettingsPage,
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
  questionPaperTemplatePage,
];

/**
 * The settings navigation. `studentManagement` is whether the school has
 * student management (unknown counts as no, like every feature check):
 * without it there are no admission documents and no student or finance
 * templates, so only the templates of the school's other features remain
 * and the Templates entry opens the first of them.
 */
function navigationFor(
  schoolId: string,
  canViewSessions: boolean,
  studentManagement: boolean,
  activeSessionId?: string,
): AppShellNavigationEntry[] {
  // A feature and a permission are separate gates; a student or finance template needs both.
  const withStudentManagement = (children: ReactNode) => (
    <RequireFeature schoolId={schoolId} feature="studentManagement">
      {children}
    </RequireFeature>
  );
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
      label: 'Organization',
      href: schoolHref(schoolId, '/settings'),
      icon: School,
      match: 'exact',
    },
    {
      type: 'item',
      id: 'admission-documents',
      // The documents an admission collects; admissions belong to student management.
      wrap: withStudentManagement,
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
      id: 'assistant-settings',
      // A feature and a permission are separate gates; the item needs both.
      wrap: (children) => (
        <RequireFeature schoolId={schoolId} feature="assistant">
          <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.MANAGE_ASSISTANT_ACCESS, resource: { kind: 'school', schoolId } }}>
            {children}
          </RequirePermissions>
        </RequireFeature>
      ),
      label: 'AI assistant',
      href: schoolHref(schoolId, '/settings/assistant'),
      icon: Sparkles,
    },
    {
      type: 'item',
      id: 'usage',
      // Its only tab is AI usage, so it needs that tab's feature and permission.
      wrap: (children) => (
        <RequireFeature schoolId={schoolId} feature="assistant">
          <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.READ_ASSISTANT_USAGE, resource: { kind: 'school', schoolId } }}>
            {children}
          </RequirePermissions>
        </RequireFeature>
      ),
      label: 'Usage',
      href: schoolHref(schoolId, '/settings/usage'),
      icon: ChartNoAxesColumn,
    },
    {
      type: 'item',
      id: 'templates',
      // Without student management the only templates left are the question
      // paper's (and the notice's, which also needs student management), so
      // the entry needs the assistant feature and opens that template.
      wrap: studentManagement
        ? withTemplatePermission
        : (children) => (
            <RequireFeature schoolId={schoolId} feature="assistant">
              {withTemplatePermission(children)}
            </RequireFeature>
          ),
      label: 'Templates',
      href: schoolHref(
        schoolId,
        studentManagement ? '/settings/templates/examination' : '/settings/templates/question-paper',
      ),
      icon: Settings,
      items: [
        {
          type: 'item',
          id: 'examination-template',
          wrap: (children) => withStudentManagement(withTemplatePermission(children)),
          label: 'Examination',
          href: schoolHref(schoolId, '/settings/templates/examination'),
          icon: ClipboardCheck,
        },
        {
          type: 'item',
          id: 'id-card-template',
          wrap: (children) => withStudentManagement(withTemplatePermission(children)),
          label: 'ID card',
          href: schoolHref(schoolId, '/settings/templates/id-card'),
          icon: FileBadge,
        },
        {
          type: 'item',
          id: 'admit-card-template',
          wrap: (children) => withStudentManagement(withTemplatePermission(children)),
          label: 'Admit card',
          href: schoolHref(schoolId, '/settings/templates/admit-card'),
          icon: GraduationCap,
        },
        {
          type: 'item',
          id: 'timetable-template',
          wrap: (children) => withStudentManagement(withTemplatePermission(children)),
          label: 'Timetable',
          href: schoolHref(schoolId, '/settings/templates/timetable'),
          icon: CalendarRange,
        },
        {
          type: 'item',
          id: 'bill-template',
          wrap: (children) => withStudentManagement(withFinanceTemplatePermission(children)),
          label: 'Bill',
          href: schoolHref(schoolId, '/settings/templates/bill'),
          icon: CreditCard,
        },
        {
          type: 'item',
          id: 'receipt-template',
          wrap: (children) => withStudentManagement(withFinanceTemplatePermission(children)),
          label: 'Receipt',
          href: schoolHref(schoolId, '/settings/templates/receipt'),
          icon: ReceiptText,
        },
        {
          type: 'item',
          id: 'statement-template',
          wrap: (children) => withStudentManagement(withFinanceTemplatePermission(children)),
          label: 'Statement',
          href: schoolHref(schoolId, '/settings/templates/statement'),
          icon: ScrollText,
        },
        {
          type: 'item',
          id: 'notice-template',
          // A feature and a permission are separate gates; the item needs both.
          wrap: (children) => (
            <RequireFeature schoolId={schoolId} feature="notices">
              {withTemplatePermission(children)}
            </RequireFeature>
          ),
          label: 'Notice',
          href: schoolHref(schoolId, '/settings/templates/notice'),
          icon: BookOpenCheck,
        },
        {
          type: 'item',
          id: 'question-paper-template',
          // The template belongs to the AI assistant feature; the item needs it and the template permission.
          wrap: (children) => (
            <RequireFeature schoolId={schoolId} feature="assistant">
              {withTemplatePermission(children)}
            </RequireFeature>
          ),
          label: 'Question paper',
          href: schoolHref(schoolId, '/settings/templates/question-paper'),
          icon: FileQuestionMark,
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
  const studentManagement = useSchoolFeature(schoolId, 'studentManagement').enabled;
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
    commandContext: {
      schoolId,
      sessionId: selectedSessionId,
      sessions,
    },
    navigation: navigationFor(
      schoolId,
      sessionPermissionQuery.data?.results[0] === true,
      studentManagement,
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

  return (
    <>
      <SchoolDocumentHead schoolId={schoolId} pageTitle={page?.title} />
      <ManagementShell state={state}>{children}</ManagementShell>
    </>
  );
}

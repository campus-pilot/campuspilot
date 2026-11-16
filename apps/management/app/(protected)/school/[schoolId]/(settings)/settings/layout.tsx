'use client';

import type { ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { AppShellIcon, AppShellNavigationEntry } from '@campuspilot/components/app-shell';
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
import { RequireFeature, useSchoolFeatureCheck } from '@/components/require-feature';
import { firstSettingsTemplate, SETTINGS_TEMPLATES } from '@/components/settings-templates';
import type { DocumentType } from '@campuspilot/api/routers/school/document/document.dto';
import type { SchoolFeatureKey } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
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

/** The sidebar icon of each settings template. */
const TEMPLATE_ICONS: Record<DocumentType, AppShellIcon> = {
  report_card: ClipboardCheck,
  id_card: FileBadge,
  admit_card: GraduationCap,
  timetable: CalendarRange,
  bill: CreditCard,
  receipt: ReceiptText,
  statement: ScrollText,
  notice: BookOpenCheck,
  question_paper: FileQuestionMark,
};

/**
 * The settings navigation. `has` answers whether the school is known to have
 * a feature (unknown counts as no, like every feature check). Every entry is
 * gated on its own feature: the admission documents on student management,
 * each template on the feature its document type belongs to
 * (`SETTINGS_TEMPLATES`). The Templates entry opens the first template the
 * school has and is left out when it has none.
 */
function navigationFor(
  schoolId: string,
  canViewSessions: boolean,
  has: (feature: SchoolFeatureKey) => boolean,
  activeSessionId?: string,
): AppShellNavigationEntry[] {
  const firstTemplate = firstSettingsTemplate(has);
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
      wrap: (children) => (
        <RequireFeature schoolId={schoolId} feature="studentManagement">
          {children}
        </RequireFeature>
      ),
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
    ...(firstTemplate
      ? [
          {
            type: 'item',
            id: 'templates',
            wrap: withTemplatePermission,
            label: 'Templates',
            href: schoolHref(schoolId, firstTemplate.path),
            icon: Settings,
            items: SETTINGS_TEMPLATES.map((template) => ({
              type: 'item' as const,
              id: template.id,
              label: template.label,
              href: schoolHref(schoolId, template.path),
              icon: TEMPLATE_ICONS[template.documentType],
              // A feature and a permission are separate gates; a template needs both.
              wrap: (children: ReactNode) => (
                <RequireFeature schoolId={schoolId} feature={template.feature}>
                  {(template.finance ? withFinanceTemplatePermission : withTemplatePermission)(children)}
                </RequireFeature>
              ),
            })),
          } satisfies AppShellNavigationEntry,
        ]
      : []),
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
  const hasFeature = useSchoolFeatureCheck(schoolId);
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
      hasFeature,
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

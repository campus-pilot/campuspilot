'use client';

import type { ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import {
  ManagementShell,
  type ManagementShellState,
} from '@/components/management-shell';
import {
  resolveManagementPageActions,
  type ManagementPageDescriptor,
} from '@/components/management-route';
import type { SchoolRouteParams } from '@/components/school-route';
import {
  useSchoolSessions,
  useStoredSchoolSessionId,
} from '@/components/session-selection';
import { SchoolDocumentHead } from '@/components/school-document-head';
import { SessionSwitcher } from '@/components/session-switcher';
import { orpc } from '@/lib/orpc';
import { useSchoolFeatureCheck } from '@/components/require-feature';
import { settingsNavigation } from '@/components/settings-navigation';
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
    navigation: settingsNavigation({
      schoolId,
      canViewSessions: sessionPermissionQuery.data?.results[0] === true,
      has: hasFeature,
      activeSessionId,
      selectedSessionId,
    }),
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

  return (
    <>
      <SchoolDocumentHead schoolId={schoolId} pageTitle={page?.title} />
      <ManagementShell state={state}>{children}</ManagementShell>
    </>
  );
}

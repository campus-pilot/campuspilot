'use client';

import type { ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import {
  ManagementShell,
  type ManagementShellState,
} from '@/components/management-shell';
import {
  resolveManagementPageActions,
  type ManagementPageDescriptor,
} from '@/components/management-route';
import type { SchoolRouteParams } from '@/components/school-route';
import { useSchoolShellSessions } from '@/components/session-selection';
import { SchoolDocumentHead } from '@/components/school-document-head';
import { RealSchoolOnly } from '@/components/personal-space/school-kind-gates';
import { SessionSwitcher } from '@/components/session-switcher';
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

/** A school's settings; a personal space has none, so its addresses here open its papers (docs/personal-space.md). */
export default function SchoolSettingsLayout({ children }: { children: ReactNode }) {
  const routeParams = useParams();
  const schoolId = String(routeParams.schoolId ?? '');
  return (
    <RealSchoolOnly schoolId={schoolId}>
      <SchoolSettingsShell>{children}</SchoolSettingsShell>
    </RealSchoolOnly>
  );
}

function SchoolSettingsShell({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const routeParams = useParams();
  const schoolId = String(routeParams.schoolId ?? '');
  const page = pages.find((candidate) => candidate.matches(pathname));
  const hasFeature = useSchoolFeatureCheck(schoolId);
  const { canListSessions, sessions, hasNoSessions, activeSessionId, selectedSessionId } = useSchoolShellSessions(schoolId);
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
      canViewSessions: canListSessions,
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
        hasNoSessions={hasNoSessions}
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

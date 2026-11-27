import { NotebookPen } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import { QuickPaperBreadcrumbValue } from '@/components/question-paper/question-paper-breadcrumb-value';
import { schoolQuestionPapersHref } from '@/components/question-paper/school-question-papers-model';
import { sessionPageBreadcrumbs } from '@/components/session-page-breadcrumbs';
import type { SchoolSessionRouteParams } from '@/components/school-route';

/** Session crumbs with "Question papers"; `linked` makes it the way back from a paper below it. */
function questionPapersTrail({ schoolId, sessionId }: SchoolSessionRouteParams, linked: boolean) {
  return sessionPageBreadcrumbs(schoolId, sessionId, { id: 'question-papers', label: 'Question papers', icon: NotebookPen }).map((breadcrumb) =>
    linked && breadcrumb.id === 'question-papers' ? { ...breadcrumb, href: schoolQuestionPapersHref({ schoolId, sessionId }) } : breadcrumb,
  );
}

export const questionPapersPage = defineManagementPage<SchoolSessionRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/sessions\/[^/]+\/question-papers$/.test(pathname),
  title: 'Question papers',
  breadcrumbs: (params) => questionPapersTrail(params, false),
});

/** One quick paper; the breadcrumb resolves the paper's subject. */
export const quickPaperPage = defineManagementPage<SchoolSessionRouteParams & { paperId: string }>({
  matches: (pathname) => /^\/school\/[^/]+\/sessions\/[^/]+\/question-papers\/[^/]+$/.test(pathname),
  title: 'Question paper',
  breadcrumbs: ({ paperId, ...params }) => [
    ...questionPapersTrail(params, true),
    { id: 'quick-paper', label: <QuickPaperBreadcrumbValue target={{ schoolId: params.schoolId, paperId }} /> },
  ],
});

export const questionPapersPages = [questionPapersPage, quickPaperPage];

import { ClipboardCheck } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import { sessionPageBreadcrumbs } from '@/components/session-page-breadcrumbs';
import type { SchoolSessionRouteParams } from '@/components/school-route';
import {
  ExamBreadcrumbValue,
  ExamClassBreadcrumbValue,
  ExamStudentBreadcrumbValue,
} from '@/components/exam/exam-breadcrumb-value';
import { examHref, examClassHref, questionPaperHref } from '@/components/exam/exam-model';
import { QuestionPaperBreadcrumbValue } from '@/components/question-paper/question-paper-breadcrumb-value';
import { ExamNavbarActions } from '@/components/exam/exam-navbar-actions';

export const examPage = defineManagementPage<SchoolSessionRouteParams>({
  matches: (pathname) =>
    /^\/school\/[^/]+\/sessions\/[^/]+\/exam$/.test(pathname),
  title: 'Examinations',
  breadcrumbs: ({ schoolId, sessionId }) =>
    sessionPageBreadcrumbs(schoolId, sessionId, {
      id: 'exam',
      label: 'Examinations',
      icon: ClipboardCheck,
    }),
});

/** Exam identity is resolved from session configuration, so renamed definitions
 * appear in breadcrumbs and deep links without a hard-coded slug label.
 */
export const examDetailsPage = defineManagementPage<
  SchoolSessionRouteParams & {
    examSlug: string;
    classId?: string;
    studentId?: string;
  }
>({
  matches: (pathname) =>
    /^\/school\/[^/]+\/sessions\/[^/]+\/exam\/[^/]+(?:\/|$)/.test(pathname),
  actions: (scope) => <ExamNavbarActions scope={scope} />,
  title: 'Examination',
  breadcrumbs: (scope) => [
    ...examPage
      .breadcrumbs(scope)
      .map((crumb) =>
        crumb.id === 'exam' ? { ...crumb, href: examHref(scope) } : crumb,
      ),
    {
      id: 'exam-name',
      label: <ExamBreadcrumbValue scope={scope} />,
      href: examHref(scope, scope.examSlug),
    },
    ...(scope.classId
      ? [
          {
            id: 'exam-class',
            label: (
              <ExamClassBreadcrumbValue
                scope={{ ...scope, classId: scope.classId }}
              />
            ),
            href: examClassHref({ ...scope, classId: scope.classId }),
          },
        ]
      : []),
    ...(scope.classId && scope.studentId
      ? [
          {
            id: 'exam-student',
            label: (
              <ExamStudentBreadcrumbValue
                scope={{
                  ...scope,
                  classId: scope.classId,
                  studentId: scope.studentId,
                }}
              />
            ),
          },
        ]
      : []),
  ],
});

type QuestionPaperRouteParams = SchoolSessionRouteParams & {
  examSlug: string;
  classId?: string;
  subjectSlug?: string;
  modeSlug?: string;
};

/** Exam crumbs down to the exam, shared by the Question paper pages. */
function questionPaperTrail(scope: SchoolSessionRouteParams & { examSlug: string }) {
  return [
    ...examPage
      .breadcrumbs(scope)
      .map((crumb) => (crumb.id === 'exam' ? { ...crumb, href: examHref(scope) } : crumb)),
    {
      id: 'exam-name',
      label: <ExamBreadcrumbValue scope={scope} />,
      href: examHref(scope, scope.examSlug),
    },
  ];
}

/**
 * The Question paper tab. It is listed before `examDetailsPage`, which also
 * matches every path below the exam: its class crumb would otherwise link
 * these pages to the results class page.
 */
export const questionPaperListPage = defineManagementPage<QuestionPaperRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/sessions\/[^/]+\/exam\/[^/]+\/question-paper\/?$/.test(pathname),
  title: 'Question paper',
  breadcrumbs: (scope) => [...questionPaperTrail(scope), { id: 'question-paper', label: 'Question paper' }],
});

/** One paper: the crumb names its class, subject and mode. */
export const questionPaperDetailsPage = defineManagementPage<QuestionPaperRouteParams>({
  matches: (pathname) =>
    /^\/school\/[^/]+\/sessions\/[^/]+\/exam\/[^/]+\/question-paper\/[^/]+\/[^/]+\/[^/]+\/?$/.test(pathname),
  title: 'Question paper',
  breadcrumbs: (scope) => [
    ...questionPaperTrail(scope),
    { id: 'question-paper', label: 'Question paper', href: questionPaperHref(scope) },
    ...(scope.classId && scope.subjectSlug && scope.modeSlug
      ? [
          {
            id: 'question-paper-paper',
            label: (
              <QuestionPaperBreadcrumbValue
                scope={{ ...scope, classId: scope.classId, subjectSlug: scope.subjectSlug, modeSlug: scope.modeSlug }}
              />
            ),
          },
        ]
      : []),
  ],
});

export const questionPaperPages = [questionPaperListPage, questionPaperDetailsPage];

import { ClipboardCheck } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import { sessionPageBreadcrumbs } from '@/components/session-page-breadcrumbs';
import type { SchoolSessionRouteParams } from '@/components/school-route';
import {
  ExamBreadcrumbValue,
  ExamClassBreadcrumbValue,
  ExamStudentBreadcrumbValue,
} from '@/components/exam/exam-breadcrumb-value';
import { examHref, examClassHref } from '@/components/exam/exam-model';
import { ExamNavbarActions } from '@/components/exam/exam-navbar-actions';

export const examPage = defineManagementPage<SchoolSessionRouteParams>({
  matches: (pathname) =>
    /^\/school\/[^/]+\/sessions\/[^/]+\/exam$/.test(pathname),
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

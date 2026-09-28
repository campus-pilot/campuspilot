import { GraduationCap } from 'lucide-react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { AddClassAction } from '@/components/add-class-action';
import { AddStudentAction } from '@/components/add-student-action';
import { defineManagementPage } from '@/components/management-route';
import { RequirePermissions } from '@/components/require-permissions';
import { sessionPageBreadcrumbs } from '@/components/session-page-breadcrumbs';
import { schoolSessionHref, type SchoolSessionRouteParams } from '@/components/school-route';
import { StudentBreadcrumbValue } from '@/components/student-breadcrumb-value';

export const classroomPage = defineManagementPage<SchoolSessionRouteParams>({
  matches: (pathname) =>
    /^\/school\/[^/]+\/sessions\/[^/]+\/classroom$/.test(pathname),
  breadcrumbs: ({ schoolId, sessionId }) =>
    sessionPageBreadcrumbs(schoolId, sessionId, { id: 'classroom', label: 'Classroom', icon: GraduationCap }),
  actions: ({ schoolId }) => (
    <RequirePermissions
      permissions={{
        action: SCHOOL_ACTIONS.CREATE_CLASS,
        resource: { kind: 'school', schoolId },
      }}
    >
      <AddClassAction schoolId={schoolId} />
    </RequirePermissions>
  ),
});

export const classroomDetailsPage = defineManagementPage<SchoolSessionRouteParams>({
  matches: (pathname) =>
    /^\/school\/[^/]+\/sessions\/[^/]+\/classroom\/[^/]+(?:\/.*)?$/.test(
      pathname,
    ),
  breadcrumbs: ({ schoolId, sessionId }) =>
    sessionPageBreadcrumbs(schoolId, sessionId, {
      id: 'classroom',
      label: 'Classroom',
      icon: GraduationCap,
    }),
});

type ClassStudentsRouteParams = SchoolSessionRouteParams & { classId: string };

export const classStudentsPage = defineManagementPage<ClassStudentsRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/sessions\/[^/]+\/classroom\/[^/]+\/students$/.test(pathname),
  breadcrumbs: classroomDetailsPage.breadcrumbs,
  actions: ({ schoolId, sessionId, classId }) => <AddStudentAction schoolId={schoolId} sessionId={sessionId} classId={classId} />,
});

type ClassStudentDetailsRouteParams = ClassStudentsRouteParams & { studentId: string };

export const classStudentDetailsPage = defineManagementPage<ClassStudentDetailsRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/sessions\/[^/]+\/classroom\/[^/]+\/students\/[^/]+$/.test(pathname),
  breadcrumbs: ({ schoolId, sessionId, classId, studentId }) => [
    ...sessionPageBreadcrumbs(schoolId, sessionId, { id: 'classroom', label: 'Classroom', icon: GraduationCap }).map((breadcrumb) => breadcrumb.id === 'classroom' ? { ...breadcrumb, href: schoolSessionHref(schoolId, sessionId, `/classroom/${encodeURIComponent(classId)}/students`) } : breadcrumb),
    { id: 'student-name', label: <StudentBreadcrumbValue schoolId={schoolId} sessionId={sessionId} studentId={studentId} />, href: schoolSessionHref(schoolId, sessionId, `/classroom/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}`) },
    { id: 'student-details', label: 'Details' },
  ],
});

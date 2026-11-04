import type { ReactNode } from 'react';
import {
  SCHOOL_ACTIONS,
  type PermissionCheck,
} from '@campuspilot/api/routers/authorization/authorization.dto';
import type { AppShellIcon } from '@campuspilot/components/app-shell';
import {
  ClipboardCheck,
  GraduationCap,
  Settings,
  UserRoundPlus,
  WandSparkles,
} from 'lucide-react';
import { RequirePermissions } from './require-permissions';
import { schoolHref, schoolSessionHref } from './school-route';
export {
  commandFuzzyScore,
  filterManagementCommands,
} from './management-command-model';

export type ManagementCommandContext = {
  schoolId: string;
  sessionId?: string;
};

export type ManagementCommandDefinition = {
  id: string;
  label: string;
  description: string;
  icon: AppShellIcon;
  keywords: readonly string[];
  defaultSuggestion: boolean;
  requiresSession?: boolean;
  destination: (context: ManagementCommandContext) => string;
  wrap: (children: ReactNode) => ReactNode;
};

/**
 * Each complete command is independently permission-composed. Session needs
 * remain a separate disabled state after authorization succeeds; no command
 * infers one permission, selected session, or destination from another.
 */
export function createManagementCommandRegistry(
  context: ManagementCommandContext,
): ManagementCommandDefinition[] {
  const permissionWrap = (action: (typeof SCHOOL_ACTIONS)[keyof typeof SCHOOL_ACTIONS]) =>
    (children: ReactNode) => (
      <RequirePermissions
        permissions={
          {
            action,
            resource: { kind: 'school', schoolId: context.schoolId },
          } as PermissionCheck
        }
      >
        {children}
      </RequirePermissions>
    );

  return [
    {
      id: 'admission',
      label: 'Admission',
      description: 'Open admissions and student records',
      icon: UserRoundPlus,
      keywords: ['students', 'registration', 'enrolment'],
      defaultSuggestion: true,
      destination: ({ schoolId }) => schoolHref(schoolId, '/admission'),
      wrap: permissionWrap(SCHOOL_ACTIONS.LIST_ADMISSIONS),
    },
    {
      id: 'classroom',
      label: 'Classroom',
      description: 'Open classes and enrolled students',
      icon: GraduationCap,
      keywords: ['classes', 'sections', 'students'],
      defaultSuggestion: true,
      requiresSession: true,
      destination: ({ schoolId, sessionId }) =>
        sessionId
          ? schoolSessionHref(schoolId, sessionId, '/classroom')
          : schoolHref(schoolId),
      wrap: permissionWrap(SCHOOL_ACTIONS.LIST_CLASSES),
    },
    {
      id: 'examinations',
      label: 'Examinations',
      description: 'Open examinations for the selected session',
      icon: ClipboardCheck,
      keywords: ['exam', 'results', 'assessments'],
      defaultSuggestion: true,
      requiresSession: true,
      destination: ({ schoolId, sessionId }) =>
        sessionId
          ? schoolSessionHref(schoolId, sessionId, '/exam')
          : schoolHref(schoolId),
      wrap: permissionWrap(SCHOOL_ACTIONS.READ_EXAMS),
    },
    {
      id: 'settings',
      label: 'Settings',
      description: 'Open school settings',
      icon: Settings,
      keywords: ['school', 'configuration', 'preferences'],
      defaultSuggestion: false,
      destination: ({ schoolId }) => schoolHref(schoolId, '/settings'),
      wrap: permissionWrap(SCHOOL_ACTIONS.READ_DETAILS),
    },
    {
      id: 'templates',
      label: 'Templates',
      description: 'Open examination document templates',
      icon: WandSparkles,
      keywords: ['documents', 'report cards', 'design'],
      defaultSuggestion: false,
      destination: ({ schoolId }) =>
        schoolHref(schoolId, '/settings/templates/examination'),
      wrap: permissionWrap(SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES),
    },
  ];
}

import type { ReactNode } from 'react';
import {
  SCHOOL_ACTIONS,
  type PermissionCheck,
} from '@campuspilot/api/routers/authorization/authorization.dto';
import type { AppShellIcon } from '@campuspilot/components/app-shell';
import {
  ClipboardCheck,
  GraduationCap,
  NotebookPen,
  Settings,
  UserRoundPlus,
  WandSparkles,
} from 'lucide-react';
import { AssistantAccess } from './assistant/assistant-access';
import { RequireFeature } from './require-feature';
import { RequirePermissions } from './require-permissions';
import { schoolHref, schoolSessionHref } from './school-route';
export {
  commandFuzzyScore,
  filterManagementCommands,
} from './management-command-model';

export type ManagementCommandContext = {
  schoolId: string;
  sessionId?: string;
  /**
   * The address (below the school) of the first settings template the school
   * has (`firstSettingsTemplate`), or null when it has none. The Templates
   * command opens it and is not offered without one. Undefined while the
   * caller has not looked (the command is then not offered either).
   */
  firstTemplatePath?: string | null;
};

/** A palette command: choosing it goes to its `destination`. */
export type ManagementCommandDefinition = {
  id: string;
  label: string;
  description: string;
  icon: AppShellIcon;
  keywords: readonly string[];
  defaultSuggestion: boolean;
  requiresSession?: boolean;
  wrap: (children: ReactNode) => ReactNode;
  kind: 'navigate';
  destination: (context: ManagementCommandContext) => string;
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

  const anyPermissionWrap = (actions: (typeof SCHOOL_ACTIONS)[keyof typeof SCHOOL_ACTIONS][]) =>
    (children: ReactNode) => (
      <RequirePermissions
        mode="any"
        permissions={actions.map(
          (action) => ({ action, resource: { kind: 'school', schoolId: context.schoolId } }) as PermissionCheck,
        )}
      >
        {children}
      </RequirePermissions>
    );

  // A feature and a permission are separate gates; a command of a feature needs both.
  const studentManagementWrap = (inner: (children: ReactNode) => ReactNode) =>
    (children: ReactNode) => (
      <RequireFeature schoolId={context.schoolId} feature="studentManagement">
        {inner(children)}
      </RequireFeature>
    );

  return [
    {
      id: 'admission',
      label: 'Admission',
      description: 'Open admissions and student records',
      icon: UserRoundPlus,
      keywords: ['students', 'registration', 'enrolment'],
      defaultSuggestion: true,
      kind: 'navigate',
      destination: ({ schoolId }) => schoolHref(schoolId, '/admission'),
      wrap: studentManagementWrap(permissionWrap(SCHOOL_ACTIONS.LIST_ADMISSIONS)),
    },
    {
      id: 'classroom',
      label: 'Classroom',
      description: 'Open classes and enrolled students',
      icon: GraduationCap,
      keywords: ['classes', 'sections', 'students'],
      defaultSuggestion: true,
      requiresSession: true,
      kind: 'navigate',
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
      kind: 'navigate',
      destination: ({ schoolId, sessionId }) =>
        sessionId
          ? schoolSessionHref(schoolId, sessionId, '/exam')
          : schoolHref(schoolId),
      wrap: permissionWrap(SCHOOL_ACTIONS.READ_EXAMS),
    },
    {
      id: 'question-papers',
      label: 'Question papers',
      description: 'Open quick papers and exam papers of the session',
      icon: NotebookPen,
      keywords: ['question paper', 'papers', 'quick paper', 'exam paper', 'ai'],
      defaultSuggestion: false,
      requiresSession: true,
      kind: 'navigate',
      destination: ({ schoolId, sessionId }) =>
        sessionId ? schoolSessionHref(schoolId, sessionId, '/question-papers') : schoolHref(schoolId),
      // Separate gates, each its own fact, as the sidebar entry: either paper
      // permission the page lists by, and the assistant (question papers
      // belong to its feature).
      wrap: (children) =>
        anyPermissionWrap([SCHOOL_ACTIONS.READ_EXAM_PLANS, SCHOOL_ACTIONS.READ_STANDALONE_PAPERS])(
          <AssistantAccess schoolId={context.schoolId}>{children}</AssistantAccess>,
        ),
    },
    {
      id: 'settings',
      label: 'Settings',
      description: 'Open organization settings',
      icon: Settings,
      keywords: ['school', 'configuration', 'preferences'],
      defaultSuggestion: false,
      kind: 'navigate',
      destination: ({ schoolId }) => schoolHref(schoolId, '/settings'),
      wrap: permissionWrap(SCHOOL_ACTIONS.READ_DETAILS),
    },
    // Offered only when the school has a template, and opens that one: the
    // examination template for a school with student management, otherwise
    // the first template of a feature it does have (`firstSettingsTemplate`).
    ...(context.firstTemplatePath
      ? [
          {
            id: 'templates',
            label: 'Templates',
            description: 'Open document templates',
            icon: WandSparkles,
            keywords: ['documents', 'report cards', 'question paper', 'design'],
            defaultSuggestion: false,
            kind: 'navigate' as const,
            destination: ({ schoolId, firstTemplatePath }: ManagementCommandContext) =>
              schoolHref(schoolId, firstTemplatePath ?? '/settings'),
            wrap: permissionWrap(SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES),
          },
        ]
      : []),
  ];
}

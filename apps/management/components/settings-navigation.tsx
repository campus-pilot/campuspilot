import type { ReactNode } from 'react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { DocumentType } from '@campuspilot/api/routers/school/document/document.dto';
import type { SchoolFeatureKey } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import type { AppShellIcon, AppShellNavigationEntry } from '@campuspilot/components/app-shell';
import {
  ArrowLeft,
  BookOpenCheck,
  CalendarDays,
  CalendarRange,
  ChartNoAxesColumn,
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
import { RequireFeature } from './require-feature';
import { RequirePermissions } from './require-permissions';
import { schoolHref, schoolSessionHref } from './school-route';
import { firstSettingsTemplate, SETTINGS_TEMPLATES } from './settings-templates';

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

export type SettingsNavigationInput = {
  schoolId: string;
  /** Whether the user may list the school's sessions (the Sessions entry). */
  canViewSessions: boolean;
  /** Whether the school is known to have a feature (unknown counts as no, like every feature check). */
  has: (feature: SchoolFeatureKey) => boolean;
  /** The school's active session, which the Sessions entry opens. */
  activeSessionId?: string;
  /**
   * The session the user is working in (their stored choice, else the active
   * one), whose dashboard "Back to dashboard" opens. Kept apart from
   * `activeSessionId`: the two often coincide but answer different questions.
   */
  selectedSessionId?: string;
};

/**
 * The settings navigation. "Back to dashboard" comes first, where users look
 * for a way back; it opens the dashboard of the selected session, or the
 * school's home when no session is known yet. It is an ordinary navigation
 * item, so it renders like the others in the desktop sidebar and the mobile
 * sheet (which it closes when followed).
 *
 * Every settings entry is gated on its own feature: the admission documents
 * on student management, each template on the feature its document type
 * belongs to (`SETTINGS_TEMPLATES`). The Templates entry opens the first
 * template the school has and is left out when it has none.
 */
export function settingsNavigation({
  schoolId,
  canViewSessions,
  has,
  activeSessionId,
  selectedSessionId,
}: SettingsNavigationInput): AppShellNavigationEntry[] {
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
      id: 'back-to-dashboard',
      label: 'Back to dashboard',
      href: selectedSessionId
        ? schoolSessionHref(schoolId, selectedSessionId)
        : schoolHref(schoolId),
      icon: ArrowLeft,
      // It leaves Settings, so it is never the page being shown here.
      isActive: () => false,
    },
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

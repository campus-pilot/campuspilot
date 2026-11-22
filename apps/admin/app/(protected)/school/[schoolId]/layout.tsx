'use client';

import type { ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import type { AppShellNavigationEntry } from '@campuspilot/components/app-shell';
import {
  CalendarDays,
  Database,
  Flag,
  Files,
  GraduationCap,
  LayoutDashboard,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AdminShell, type AdminShellState } from '@/components/admin-shell';
import { resolveAdminPageActions } from '@/components/admin-route';
import { orpc } from '@/lib/orpc';
import { dashboardPage } from './_route';
import { sessionsPage } from './sessions/_route';
import { sessionDetailPage } from './sessions/[sessionId]/_route';
import { settingsPage } from './settings/_route';
import { documentSettingsPage } from './settings/documents/_route';
import { staffPage } from './staff/_route';
import { studentsPage } from './students/_route';
import { aiUsagePage } from './usage/ai/_route';
import { featureFlagsPage } from './usage/feature-flags/_route';
import { storageUsagePage } from './usage/storage/_route';
import { schoolHref, type SchoolRouteParams } from './school-route';

const pages = [
  dashboardPage,
  sessionDetailPage,
  sessionsPage,
  staffPage,
  studentsPage,
  aiUsagePage,
  storageUsagePage,
  featureFlagsPage,
  settingsPage,
  documentSettingsPage,
];

/**
 * The sections of a real school that a personal space has none of
 * (docs/personal-space.md): its sessions, staff, students and document
 * settings, whose `school.*` procedures serve real schools only. A personal
 * space's admin pages are its dashboard, its usage, its plan and features and
 * its settings (billing renews its trial).
 */
const REAL_SCHOOL_SECTIONS = ['/sessions', '/staff', '/students', '/settings/documents'] as const;

function isRealSchoolSection(pathname: string, schoolId: string) {
  return REAL_SCHOOL_SECTIONS.some((section) => {
    const href = schoolHref(schoolId, section);
    return pathname === href || pathname.startsWith(`${href}/`);
  });
}

function navigationFor(
  schoolId: string,
  activeSessionId?: string,
  personal = false,
): AppShellNavigationEntry[] {
  if (personal) return personalSpaceNavigationFor(schoolId);

  return [
    {
      type: 'group',
      id: 'general',
      label: 'General',
      items: [
        {
          type: 'item',
          id: 'dashboard',
          label: 'Dashboard',
          href: schoolHref(schoolId),
          icon: LayoutDashboard,
          match: 'exact',
        },
        {
          type: 'item',
          id: 'sessions',
          label: 'Sessions',
          href: activeSessionId
            ? schoolHref(schoolId, `/sessions/${activeSessionId}`)
            : schoolHref(schoolId, '/sessions'),
          icon: CalendarDays,
          isActive: (currentPath) =>
            currentPath === schoolHref(schoolId, '/sessions') ||
            currentPath.startsWith(schoolHref(schoolId, '/sessions/')),
        },

        {
          type: 'item',
          id: 'staff',
          label: 'Staff',
          href: schoolHref(schoolId, '/staff'),
          icon: Users,
        },
        {
          type: 'item',
          id: 'students',
          label: 'Students',
          href: schoolHref(schoolId, '/students'),
          icon: GraduationCap,
        },
      ],
    },
    {
      type: 'group',
      id: 'usage',
      label: 'Usage',
      items: [
        {
          type: 'item',
          id: 'ai-usage',
          label: 'AI',
          href: schoolHref(schoolId, '/usage/ai'),
          icon: Sparkles,
        },
        {
          type: 'item',
          id: 'storage-usage',
          label: 'Storage',
          href: schoolHref(schoolId, '/usage/storage'),
          icon: Database,
        },
        {
          type: 'item',
          id: 'feature-flags',
          label: 'Plan and features',
          href: schoolHref(schoolId, '/usage/feature-flags'),
          icon: Flag,
        },
      ],
    },
    {
      type: 'item',
      id: 'settings',
      label: 'Settings',
      href: schoolHref(schoolId, '/settings'),
      icon: Settings,
      isActive: (currentPath) =>
        currentPath === schoolHref(schoolId, '/settings'),
    },
    {
      type: 'item',
      id: 'admission-documents',
      label: 'Documents',
      href: schoolHref(schoolId, '/settings/documents'),
      icon: Files,
    },
  ];
}

/** A personal space's navigation: its dashboard, usage, plan and features, and settings (no sessions, staff, students or documents). */
function personalSpaceNavigationFor(schoolId: string): AppShellNavigationEntry[] {
  return navigationFor(schoolId).flatMap((entry): AppShellNavigationEntry[] => {
    if (entry.type === 'item') return entry.id === 'admission-documents' ? [] : [entry];
    if (entry.type !== 'group') return [entry];
    const items = entry.items.filter((item) => !['sessions', 'staff', 'students'].includes(item.id));
    return items.length > 0 ? [{ ...entry, items }] : [];
  });
}

export default function SchoolLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const routeParams = useParams();
  const schoolId = String(routeParams.schoolId ?? '');
  // The school's kind decides which sections exist (docs/personal-space.md); nothing of a real school is read before it is known.
  const schoolQuery = useQuery(orpc.systemAdmin.getSchool.queryOptions({ input: { id: schoolId } }));
  const kind = schoolQuery.data?.kind;
  const sessionsQuery = useQuery({
    ...orpc.school.listSessions.queryOptions({
      input: { schoolId, limit: 1, filters: { isActive: true } },
    }),
    enabled: kind === 'school',
  });
  const activeSession = sessionsQuery.data?.items[0];

  const page = pages.find((candidate) => candidate.matches(pathname));
  const params = { schoolId, ...routeParams } as any;
  const personal = kind === 'personal';
  const state: AdminShellState = {
    navigation: navigationFor(schoolId, activeSession?.id, personal),
    breadcrumbs: page?.breadcrumbs(params) ?? [],
    navbarActions: personal && isRealSchoolSection(pathname, schoolId) ? null : resolveAdminPageActions(page, params),
  };

  return (
    <AdminShell state={state}>
      {personal && isRealSchoolSection(pathname, schoolId) ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Not available for a personal space. A personal space has no sessions, staff, students or document settings; it holds
          one person&apos;s question papers.
        </p>
      ) : (
        children
      )}
    </AdminShell>
  );
}

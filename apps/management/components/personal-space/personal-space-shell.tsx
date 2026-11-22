'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { notFound } from 'next/navigation';
import { env } from '@campuspilot/env/management.client';
import { Alert, AlertDescription } from '@campuspilot/ui/components/alert';
import { Badge } from '@campuspilot/ui/components/badge';
import Link from 'next/link';
import { PersonalBreadcrumbs } from './personal-breadcrumbs';
import { TriangleAlert } from 'lucide-react';
import { AuthLoading } from '@/components/auth-loading';
import { ManagementAccountMenu } from '@/components/management-account-menu';
import { SchoolDocumentHead } from '@/components/school-document-head';
import { SchoolSwitcher } from '@/components/school-switcher';
import { orpc } from '@/lib/orpc';
import { contactHrefOf, personalPapersHref, personalPlanNoticeOf, personalPlanStatusOf } from './personal-space-model';

/** The user's entry for this school, from the cached school list the switcher also reads. */
function useMySchool(schoolId: string) {
  const schoolsQuery = useQuery(orpc.school.listMySchools.queryOptions());
  return { school: schoolsQuery.data?.find((school) => school.id === schoolId), isPending: schoolsQuery.isPending };
}

/** The website's contact page, in a new tab. */
function ContactLink({ children }: { children: ReactNode }) {
  return (
    <a href={contactHrefOf(env.NEXT_PUBLIC_WEBSITE_URL)} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4">
      {children}
    </a>
  );
}

/**
 * What the space says about its plan, under the bar: that the trial ended (or
 * the space is suspended), or that it ends soon, with the way to continue: the
 * website's contact page. It is part of the page rather than an `AppShellAlert`
 * because a personal space has no app shell (no sidebar, no alert list). On
 * wide screens it is one line of fixed height (`--app-shell-alerts`), so the
 * studio below still fills the window exactly.
 */
function PlanNotice({ notice }: { notice: NonNullable<ReturnType<typeof personalPlanNoticeOf>> }) {
  return (
    <div className="px-4 pt-3 sm:px-6 lg:px-8">
      <Alert role={notice.kind === 'ended' ? 'alert' : 'status'} className="md:h-11 md:py-2.5">
        <TriangleAlert aria-hidden />
        <AlertDescription className="md:truncate">
          {notice.message} <ContactLink>{notice.contact}</ContactLink>.
        </AlertDescription>
      </Alert>
    </div>
  );
}

/**
 * The frame of a personal space (docs/personal-space.md): no sidebar on any
 * screen size, one bar on top with "Personal" and the school switcher on the
 * left, then the breadcrumbs (Papers › the paper, the way back, as
 * everywhere in the app; the Personal label links to the papers too), and
 * the plan's status and the user menu on the right. Only a school of
 * kind `personal` is shown here; any other school's address under these
 * routes is not found (its own pages live in the workspace).
 *
 * The main area keeps the workspace's padding and fill height
 * (`APP_SHELL_FILL_HEIGHT_MD_CLASS` reads the 4.5rem bar and
 * `--app-shell-alerts`), so the question paper studio lays itself out here as
 * it does in a school.
 */
export function PersonalSpaceShell({ schoolId, pageTitle, children }: { schoolId: string; pageTitle?: string; children: ReactNode }) {
  const { school, isPending } = useMySchool(schoolId);
  if (isPending) return <AuthLoading label="Opening your personal space…" />;
  // A school the user belongs to (`SchoolAccessBoundary` checked) that is not a personal space has no papers here.
  if (!school || school.kind !== 'personal') notFound();
  const notice = personalPlanNoticeOf(school);
  const status = personalPlanStatusOf(school);
  return (
    <div className="flex min-h-svh flex-col bg-background" style={notice ? { ['--app-shell-alerts' as string]: '3.5rem' } : undefined}>
      <SchoolDocumentHead schoolId={schoolId} pageTitle={pageTitle} />
      <header className="flex h-[4.5rem] shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          {/* The space's name for itself, and the way back to its papers from anywhere in it. */}
          <Link href={personalPapersHref(schoolId)} className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Badge variant="secondary">Personal</Badge>
          </Link>
          <div className="w-36 min-w-0 sm:w-56">
            <SchoolSwitcher />
          </div>
          <PersonalBreadcrumbs schoolId={schoolId} />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {status ? <span className="text-xs text-muted-foreground max-sm:hidden">{status}</span> : null}
          <ManagementAccountMenu />
        </div>
      </header>
      {notice ? <PlanNotice notice={notice} /> : null}
      <main className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}

'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@campuspilot/ui/components/alert';
import { Building2, Clock3 } from 'lucide-react';
import { AuthLoading } from '@/components/auth-loading';
import { ManagementAccountMenu } from '@/components/management-account-menu';
import {
  clearStoredSchoolId,
  getStoredSchoolId,
  SchoolEntryRedirect,
} from '@/components/school-selection';
import { orpc } from '@/lib/orpc';

function SchoolPageNavbar() {
  return (
    <header className="flex h-16 items-center justify-between border-b bg-background px-5 sm:px-8">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Building2 className="size-4" aria-hidden="true" />
        </span>
        <span className="text-sm font-semibold">CampusPilot</span>
      </div>
      <ManagementAccountMenu />
    </header>
  );
}

function NoSchoolsEmptyState() {
  /** Removes a stale tenant after the user's final membership is revoked. */
  const clearSelection = useCallback((node: HTMLElement | null) => {
    if (node) clearStoredSchoolId();
  }, []);

  return (
    <div ref={clearSelection} className="min-h-svh bg-muted/20">
      <SchoolPageNavbar />
      <main className="grid min-h-[calc(100svh-4rem)] place-items-center px-6 py-12">
        <section className="flex w-full max-w-lg flex-col items-center gap-6 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Building2 className="size-6" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              You are not part of a school yet
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Ask a school administrator to invite you to their CampusPilot
              workspace.
            </p>
          </div>
          <Alert className="max-w-md p-4 text-left">
            <Clock3 aria-hidden="true" />
            <AlertTitle>Stay tuned</AlertTitle>
            <AlertDescription>
              Self-service school creation is coming in a future update. For
              now, schools can only be created by a CampusPilot administrator.
            </AlertDescription>
          </Alert>
        </section>
      </main>
    </div>
  );
}

export default function SchoolEntryPage() {
  const schoolsQuery = useQuery(orpc.school.listMySchools.queryOptions());

  if (schoolsQuery.isPending) {
    return <AuthLoading label="Finding your school…" />;
  }

  if (schoolsQuery.isError) {
    return (
      <div className="min-h-svh bg-muted/20">
        <SchoolPageNavbar />
        <main className="grid min-h-[calc(100svh-4rem)] place-items-center px-6">
          <p className="text-sm text-destructive">
            Unable to load your schools.
          </p>
        </main>
      </div>
    );
  }

  if (schoolsQuery.data.length > 0) {
    const storedSchoolId = getStoredSchoolId();
    const storedSchool = schoolsQuery.data.find(
      (school) => school.id === storedSchoolId,
    );
    return (
      <SchoolEntryRedirect schoolId={(storedSchool ?? schoolsQuery.data[0]!).id} />
    );
  }

  return <NoSchoolsEmptyState />;
}

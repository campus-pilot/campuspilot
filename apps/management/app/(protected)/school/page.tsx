'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { AuthLoading } from '@/components/auth-loading';
import { SchoolCreationPanel } from '@/components/school-creation/school-creation-panel';
import { CreatePersonalSpace } from '@/components/personal-space/create-personal-space';
import { landingSchoolOf } from '@/components/personal-space/personal-space-model';
import { SchoolPageNavbar } from '@/components/school-page-navbar';
import {
  clearStoredSchoolId,
  getStoredSchoolId,
  SchoolEntryRedirect,
} from '@/components/school-selection';
import { orpc } from '@/lib/orpc';

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
              Set up your school
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Create your school to start a free trial, or ask a school
              administrator to invite you to theirs.
            </p>
          </div>
          <div className="w-full max-w-md">
            <SchoolCreationPanel />
          </div>
          <CreatePersonalSpace />
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

  // A valid stored selection, else the first school, else the personal space (docs/personal-space.md).
  const landing = landingSchoolOf(schoolsQuery.data, getStoredSchoolId());
  if (landing) return <SchoolEntryRedirect school={landing} />;

  return <NoSchoolsEmptyState />;
}

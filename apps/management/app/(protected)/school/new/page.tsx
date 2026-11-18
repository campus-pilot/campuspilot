'use client';

import { Building2 } from 'lucide-react';
import { SchoolCreationPanel } from '@/components/school-creation/school-creation-panel';
import { SchoolPageNavbar } from '@/components/school-page-navbar';

/**
 * Creating another school, reached from the school switcher by someone who
 * already belongs to one (docs/school-creation.md). The panel shows the
 * create form, the request for more, or why neither is possible.
 */
export default function NewSchoolPage() {
  return (
    <div className="min-h-svh bg-muted/20">
      <SchoolPageNavbar />
      <main className="grid min-h-[calc(100svh-4rem)] place-items-center px-6 py-12">
        <section className="flex w-full max-w-lg flex-col items-center gap-6 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Building2 className="size-6" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Create a school</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Open a school of your own on CampusPilot.
            </p>
          </div>
          <div className="w-full max-w-md">
            <SchoolCreationPanel />
          </div>
        </section>
      </main>
    </div>
  );
}

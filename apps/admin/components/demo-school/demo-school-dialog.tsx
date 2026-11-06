'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import { orpc } from '@/lib/orpc';
import { DemoSchoolForm, type CreatedDemoSchool } from './demo-school-form';
import { DemoSchoolProgress } from './demo-school-progress';

/**
 * Creates a demo school, then shows its seeding progress. The dialog may be
 * closed while the job runs; the organizations table keeps showing its status.
 */
export function DemoSchoolDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [created, setCreated] = useState<CreatedDemoSchool | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{created ? 'Seeding demo school' : 'Create a demo school'}</DialogTitle>
          <DialogDescription>
            {created
              ? 'You can close this dialog; seeding continues in the background.'
              : 'A complete school with sample staff, students, exams and finance, created as you (principal).'}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <DemoSchoolProgress jobId={created.jobId} schoolId={created.schoolId} notice={created.notice} />
        ) : (
          <DemoSchoolFormLoader onCreated={setCreated} onCancel={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Loads the class catalogue first so the form starts with every class selected. */
function DemoSchoolFormLoader({
  onCreated,
  onCancel,
}: {
  onCreated: (created: CreatedDemoSchool) => void;
  onCancel: () => void;
}) {
  const catalogueQuery = useQuery(
    orpc.systemAdmin.listDemoClassCatalogue.queryOptions({ input: {} }),
  );

  if (catalogueQuery.isPending) {
    return <div className="h-96 animate-pulse rounded-lg bg-muted" aria-label="Loading classes" />;
  }
  if (catalogueQuery.isError) {
    return (
      <p className="text-sm text-destructive">
        {catalogueQuery.error instanceof Error ? catalogueQuery.error.message : 'Unable to load the demo classes.'}
      </p>
    );
  }
  return <DemoSchoolForm catalogue={catalogueQuery.data.items} onCreated={onCreated} onCancel={onCancel} />;
}

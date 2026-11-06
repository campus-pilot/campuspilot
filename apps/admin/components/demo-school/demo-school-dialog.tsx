'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import { orpc } from '@/lib/orpc';
import { DemoSchoolForm } from './demo-school-form';

/**
 * Creates a demo school. The dialog closes as soon as the school exists;
 * seeding progress continues in a persistent toast and in the organizations
 * table.
 */
export function DemoSchoolDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create a demo school</DialogTitle>
          <DialogDescription>
            A complete school with sample staff, students, exams and finance, created as you (principal).
          </DialogDescription>
        </DialogHeader>
        <DemoSchoolFormLoader onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Loads the class catalogue first so the form starts with every class selected. */
function DemoSchoolFormLoader({ onDone }: { onDone: () => void }) {
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
  return <DemoSchoolForm catalogue={catalogueQuery.data.items} onCreated={onDone} onCancel={onDone} />;
}

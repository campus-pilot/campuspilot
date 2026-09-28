'use client';

import { useState } from 'react';
import type { SectionDto } from '@campuspilot/api/routers/school/class/class.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import {
  SortableTable,
  type SortableTableColumn,
} from '@campuspilot/components/sortable-table';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@campuspilot/ui/components/alert-dialog';
import { Button } from '@campuspilot/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { client, orpc } from '@/lib/orpc';
import { FormErrors } from './form-errors';
import { RequirePermissions } from './require-permissions';

const sectionFormSchema = z.object({
  label: z.string().trim().min(1, 'Section name is required').max(200),
  slug: z
    .string()
    .trim()
    .min(1, 'Section slug is required')
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and single hyphens only'),
});

function SectionDialog({
  classId,
  schoolId,
  section,
  onClose,
}: {
  classId: string;
  schoolId: string;
  section?: SectionDto;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: { label: section?.label ?? '', slug: section?.slug ?? '' },
    validators: { onSubmit: sectionFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const parsed = sectionFormSchema.parse(value);
        if (section) {
          await client.school.updateSection({
            schoolId,
            classId,
            sectionId: section.id,
            ...parsed,
          });
        } else {
          await client.school.createSection({ schoolId, classId, ...parsed });
        }
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: orpc.school.listSections.queryKey({ input: { schoolId, classId } }),
          }),
          queryClient.invalidateQueries({
            queryKey: orpc.school.listClasses.queryKey({ input: { schoolId } }),
          }),
        ]);
        onClose();
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            form: error instanceof Error ? error.message : 'Unable to save this section.',
            fields: {},
          },
        });
      }
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{section ? 'Edit section' : 'Add section'}</DialogTitle>
          <DialogDescription>
            {section ? 'Update the section name and slug.' : 'Create another section in this classroom.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="label">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor="section-label">Section name</Label>
                <Input
                  id="section-label"
                  autoFocus
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FormErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <form.Field name="slug">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor="section-slug">Slug</Label>
                <Input
                  id="section-slug"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FormErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, errors: state.errors, isSubmitting: state.isSubmitting })}>
            {({ canSubmit, errors, isSubmitting }) => (
              <>
                <FormErrors errors={errors} />
                <DialogFooter>
                  <Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>Cancel</Button>
                  <Button type="submit" disabled={!canSubmit || isSubmitting}>
                    {isSubmitting ? 'Saving…' : section ? 'Save changes' : 'Add section'}
                  </Button>
                </DialogFooter>
              </>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SectionActions({
  section,
  schoolId,
  onEdit,
  onDelete,
}: {
  section: SectionDto;
  schoolId: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex justify-end gap-1">
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${section.label}`} onClick={onEdit}>
        <Pencil aria-hidden />
      </Button>
      <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.DELETE_SECTION, resource: { kind: 'school', schoolId } }}>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${section.label}`} onClick={onDelete}>
          <Trash2 aria-hidden />
        </Button>
      </RequirePermissions>
    </div>
  );
}

export function ClassSections({ classId, schoolId }: { classId: string; schoolId: string }) {
  const [dialogSection, setDialogSection] = useState<SectionDto | null>();
  const [deleteSection, setDeleteSection] = useState<SectionDto>();
  const queryClient = useQueryClient();
  const sectionsQuery = useQuery(orpc.school.listSections.queryOptions({ input: { schoolId, classId } }));
  const reorderMutation = useMutation({
    mutationFn: (sections: SectionDto[]) =>
      client.school.reorderSections({ schoolId, classId, orderedSectionIds: sections.map(({ id }) => id) }),
    onMutate: async (sections) => {
      const queryKey = orpc.school.listSections.queryKey({ input: { schoolId, classId } });
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<SectionDto[]>(queryKey);
      queryClient.setQueryData(queryKey, sections.map((section, index) => ({ ...section, displayOrder: index + 1 })));
      return { previous, queryKey };
    },
    onError: (_error, _sections, context) => {
      if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: orpc.school.listSections.queryKey({ input: { schoolId, classId } }) });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (section: SectionDto) => client.school.deleteSection({ schoolId, classId, sectionId: section.id }),
    onSuccess: async () => {
      setDeleteSection(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.school.listSections.queryKey({ input: { schoolId, classId } }) }),
        queryClient.invalidateQueries({ queryKey: orpc.school.listClasses.queryKey({ input: { schoolId } }) }),
      ]);
    },
  });

  if (sectionsQuery.isPending) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!sectionsQuery.data) return <p className="text-sm text-destructive">Unable to load sections.</p>;

  const columns: SortableTableColumn<SectionDto>[] = [
    { id: 'section', header: 'Section', cell: (section) => <span className="font-medium">{section.label}</span> },
    { id: 'slug', header: 'Slug', cell: (section) => <span className="text-muted-foreground">{section.slug}</span> },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-24 text-right',
      cell: (section) => (
        <SectionActions section={section} schoolId={schoolId} onEdit={() => setDialogSection(section)} onDelete={() => setDeleteSection(section)} />
      ),
    },
  ];

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Sections</h2>
          <p className="text-sm text-muted-foreground">Drag sections into the order used across this classroom.</p>
        </div>
        <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.CREATE_SECTION, resource: { kind: 'school', schoolId } }}>
          <Button type="button" onClick={() => setDialogSection(null)}><Plus aria-hidden /> Add section</Button>
        </RequirePermissions>
      </div>
      <RequirePermissions
        permissions={{ action: SCHOOL_ACTIONS.REORDER_SECTIONS, resource: { kind: 'school', schoolId } }}
        fallback={
          <SortableTable ariaLabel="Class sections" columns={columns} data={sectionsQuery.data} emptyMessage="No sections." getRowId={(section) => section.id} getRowLabel={(section) => section.label} />
        }
      >
        <SortableTable ariaLabel="Class sections" columns={columns} data={sectionsQuery.data} emptyMessage="No sections." getRowId={(section) => section.id} getRowLabel={(section) => section.label} onReorder={(sections) => reorderMutation.mutate(sections)} reorderDisabled={reorderMutation.isPending} />
      </RequirePermissions>
      {dialogSection !== undefined ? (
        <SectionDialog key={dialogSection?.id ?? 'new'} classId={classId} schoolId={schoolId} section={dialogSection ?? undefined} onClose={() => setDialogSection(undefined)} />
      ) : null}
      <AlertDialog open={deleteSection !== undefined} onOpenChange={(open) => !open && !deleteMutation.isPending && setDeleteSection(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteSection?.label}?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes the section. A classroom must keep at least one section.</AlertDialogDescription>
          </AlertDialogHeader>
          {deleteMutation.error ? <p className="text-xs text-destructive">{deleteMutation.error instanceof Error ? deleteMutation.error.message : 'Unable to delete this section.'}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <Button type="button" variant="destructive" disabled={!deleteSection || deleteMutation.isPending} onClick={() => deleteSection && deleteMutation.mutate(deleteSection)}>
              {deleteMutation.isPending ? 'Deleting…' : 'Delete section'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

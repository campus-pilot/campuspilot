'use client';

import { useState } from 'react';
import type { ClassDto } from '@campuspilot/api/routers/school/class/class.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@campuspilot/ui/components/accordion';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@campuspilot/ui/components/alert-dialog';
import { Badge } from '@campuspilot/ui/components/badge';
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
import { BookOpen, GraduationCap, Pencil, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { client, orpc } from '@/lib/orpc';
import { FormErrors } from './form-errors';

const slugSchema = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and single hyphens only');

const subjectFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Subject name is required').max(200),
    slug: slugSchema,
    examModes: z
      .array(
        z.object({
          name: z.string().trim().min(1, 'Mode name is required').max(100),
          slug: slugSchema,
          percentage: z.number().min(0).max(100),
        }),
      )
      .min(1, 'Add at least one exam mode'),
  })
  .superRefine(({ examModes }, context) => {
    if (new Set(examModes.map(({ slug }) => slug)).size !== examModes.length) {
      context.addIssue({ code: 'custom', path: ['examModes'], message: 'Exam mode slugs must be unique' });
    }
    const total = examModes.reduce((sum, mode) => sum + mode.percentage, 0);
    if (Math.abs(total - 100) > 0.001) {
      context.addIssue({ code: 'custom', path: ['examModes'], message: 'Exam mode percentages must sum to 100%' });
    }
  });

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

type SubjectFormValue = z.infer<typeof subjectFormSchema>;

function SubjectDialog({
  classData,
  originalSlug,
  schoolId,
  onClose,
}: {
  classData: ClassDto;
  originalSlug?: string;
  schoolId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const existing = originalSlug ? classData.config.subjects[originalSlug] : undefined;
  const form = useForm({
    defaultValues: {
      name: existing?.name ?? '',
      slug: originalSlug ?? '',
      examModes: existing
        ? Object.entries(existing.examModes).map(([slug, mode]) => ({ slug, ...mode }))
        : [{ name: 'Written', slug: 'written', percentage: 100 }],
    } satisfies SubjectFormValue,
    validators: { onSubmit: subjectFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const parsed = subjectFormSchema.parse(value);
        if (parsed.slug !== originalSlug && classData.config.subjects[parsed.slug]) {
          throw new Error('A subject with this slug already exists.');
        }
        const subjects = { ...classData.config.subjects };
        if (originalSlug) delete subjects[originalSlug];
        subjects[parsed.slug] = {
          name: parsed.name,
          books: existing?.books ?? [],
          examModes: Object.fromEntries(
            parsed.examModes.map(({ slug, name, percentage }) => [slug, { name, percentage }]),
          ),
        };
        await client.school.updateClassConfiguration({
          schoolId,
          classId: classData.id,
          config: { ...classData.config, subjects },
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.school.getClass.queryKey({ input: { schoolId, classId: classData.id } }) }),
          queryClient.invalidateQueries({ queryKey: orpc.school.listClasses.queryKey({ input: { schoolId } }) }),
        ]);
        onClose();
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            form: error instanceof Error ? error.message : 'Unable to save this subject.',
            fields: {},
          },
        });
      }
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? `Edit ${existing.name}` : 'Add subject'}</DialogTitle>
          <DialogDescription>Configure the subject and how marks are distributed across exam modes.</DialogDescription>
        </DialogHeader>
        <form
          className="flex max-h-[75vh] flex-col gap-5 overflow-y-auto pr-1"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="name">
              {(field) => (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="subject-name">Subject name</Label>
                  <Input
                    id="subject-name"
                    autoFocus
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      const generated = slugify(field.state.value);
                      const next = event.target.value;
                      field.handleChange(next);
                      if (!form.getFieldValue('slug') || form.getFieldValue('slug') === generated) form.setFieldValue('slug', slugify(next));
                    }}
                  />
                  <FormErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            <form.Field name="slug">
              {(field) => (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="subject-slug">Slug</Label>
                  <Input id="subject-slug" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
                  <FormErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
          </div>
          <form.Field name="examModes" mode="array">
            {(modesField) => {
              const total = modesField.state.value.reduce((sum, mode) => sum + (Number(mode.percentage) || 0), 0);
              return (
                <div className="flex flex-col gap-3">
                  <div>
                    <Label>Exam modes</Label>
                    <p className="text-xs text-muted-foreground">Percentages must sum to 100%.</p>
                  </div>
                  {modesField.state.value.map((mode, index) => (
                    <div key={index} className="grid items-start gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_7rem_auto]">
                      <form.Field name={`examModes[${index}].name`}>
                        {(field) => <div className="flex flex-col gap-1.5"><Label htmlFor={`mode-${index}-name`}>Name</Label><Input id={`mode-${index}-name`} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FormErrors errors={field.state.meta.errors} /></div>}
                      </form.Field>
                      <form.Field name={`examModes[${index}].slug`}>
                        {(field) => <div className="flex flex-col gap-1.5"><Label htmlFor={`mode-${index}-slug`}>Slug</Label><Input id={`mode-${index}-slug`} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FormErrors errors={field.state.meta.errors} /></div>}
                      </form.Field>
                      <form.Field name={`examModes[${index}].percentage`}>
                        {(field) => <div className="flex flex-col gap-1.5"><Label htmlFor={`mode-${index}-percentage`}>Percent</Label><Input id={`mode-${index}-percentage`} type="number" min={0} max={100} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.valueAsNumber)} /><FormErrors errors={field.state.meta.errors} /></div>}
                      </form.Field>
                      <Button type="button" variant="ghost" size="icon-sm" className="mt-6" aria-label={`Remove ${mode.name || `mode ${index + 1}`}`} disabled={modesField.state.value.length === 1} onClick={() => modesField.removeValue(index)}><Trash2 aria-hidden /></Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" onClick={() => modesField.pushValue({ name: '', slug: '', percentage: 0 })}><Plus aria-hidden /> Add exam mode</Button>
                  <p className={total === 100 ? 'text-xs text-emerald-600' : 'text-xs text-destructive'}>Total: {total}%</p>
                  <FormErrors errors={modesField.state.meta.errors} />
                </div>
              );
            }}
          </form.Field>
          <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, errors: state.errors, isSubmitting: state.isSubmitting })}>
            {({ canSubmit, errors, isSubmitting }) => (
              <>
                <FormErrors errors={errors} />
                <DialogFooter>
                  <Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>Cancel</Button>
                  <Button type="submit" disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Saving…' : existing ? 'Save subject' : 'Create subject'}</Button>
                </DialogFooter>
              </>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ClassSubjects({ classId, schoolId }: { classId: string; schoolId: string }) {
  const [editingSlug, setEditingSlug] = useState<string | null>();
  const [deleteSlug, setDeleteSlug] = useState<string>();
  const queryClient = useQueryClient();
  const classQuery = useQuery(orpc.school.getClass.queryOptions({ input: { schoolId, classId } }));
  const deleteMutation = useMutation({
    mutationFn: async (slug: string) => {
      if (!classQuery.data) return;
      const subjects = { ...classQuery.data.config.subjects };
      delete subjects[slug];
      await client.school.updateClassConfiguration({ schoolId, classId, config: { ...classQuery.data.config, subjects } });
    },
    onSuccess: async () => {
      setDeleteSlug(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.school.getClass.queryKey({ input: { schoolId, classId } }) }),
        queryClient.invalidateQueries({ queryKey: orpc.school.listClasses.queryKey({ input: { schoolId } }) }),
      ]);
    },
  });

  if (classQuery.isPending) return <Skeleton className="h-72 w-full rounded-xl" />;
  if (!classQuery.data) return <p className="text-sm text-destructive">Unable to load subjects.</p>;
  const subjects = Object.entries(classQuery.data.config.subjects);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold">Subjects &amp; exam modes</h2><p className="text-sm text-muted-foreground">{subjects.length} {subjects.length === 1 ? 'subject' : 'subjects'}</p></div>
        <Button type="button" onClick={() => setEditingSlug(null)}><Plus aria-hidden /> Add subject</Button>
      </div>
      {subjects.length ? (
        <Accordion type="multiple" className="rounded-xl bg-card">
          {subjects.map(([slug, subject]) => (
            <AccordionItem key={slug} value={slug} className="relative">
              <AccordionTrigger className="min-h-12 pr-40">
                <span>{subject.name} <span className="font-normal text-muted-foreground">({slug})</span></span>
              </AccordionTrigger>
              <div className="absolute right-2 top-2 flex items-center gap-1">
                <span className="hidden text-xs text-muted-foreground sm:inline">{subject.books.length} books · {Object.keys(subject.examModes).length} exam modes</span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${subject.name}`} onClick={() => setEditingSlug(slug)}><Pencil aria-hidden /></Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${subject.name}`} onClick={() => setDeleteSlug(slug)}><Trash2 aria-hidden /></Button>
              </div>
              <AccordionContent className="flex flex-col gap-5 border-t pt-4">
                <div className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-2 font-semibold"><BookOpen className="size-4" aria-hidden /> Books</h3>
                  {subject.books.length ? subject.books.map((book, index) => <p key={`${book.title}-${index}`}>{book.title}{book.author ? ` — ${book.author}` : ''}</p>) : <p className="text-muted-foreground">No books added.</p>}
                </div>
                <div className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-2 font-semibold"><GraduationCap className="size-4" aria-hidden /> Exam modes</h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(subject.examModes).map(([modeSlug, mode]) => <Badge key={modeSlug} variant="outline">{mode.name} <span className="text-muted-foreground">{mode.percentage}%</span></Badge>)}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      ) : <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">No subjects have been added yet.</div>}
      {editingSlug !== undefined ? <SubjectDialog key={editingSlug ?? 'new'} classData={classQuery.data} originalSlug={editingSlug ?? undefined} schoolId={schoolId} onClose={() => setEditingSlug(undefined)} /> : null}
      <AlertDialog open={deleteSlug !== undefined} onOpenChange={(open) => !open && !deleteMutation.isPending && setDeleteSlug(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete this subject?</AlertDialogTitle><AlertDialogDescription>This removes its books and exam-mode configuration from the classroom.</AlertDialogDescription></AlertDialogHeader>
          {deleteMutation.error ? <p className="text-xs text-destructive">{deleteMutation.error instanceof Error ? deleteMutation.error.message : 'Unable to delete this subject.'}</p> : null}
          <AlertDialogFooter><AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel><Button type="button" variant="destructive" disabled={!deleteSlug || deleteMutation.isPending} onClick={() => deleteSlug && deleteMutation.mutate(deleteSlug)}>{deleteMutation.isPending ? 'Deleting…' : 'Delete subject'}</Button></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

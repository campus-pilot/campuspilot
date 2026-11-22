'use client';

import { useState } from 'react';
import type { ClassDto } from '@campuspilot/api/routers/school/class/class.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
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
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { SubjectFormFields, SubjectFormMessages, useSubjectForm, type SubjectForm } from '@campuspilot/components/subject/subject-form';
import {
  examModesOf,
  newSubjectFormValue,
  subjectFormValueOf,
  type SubjectFormValue,
} from '@campuspilot/components/subject/subject-form-model';
import { ArrowUpRight, BookOpen, GraduationCap, Pencil, Plus, Trash2 } from 'lucide-react';
import { client, orpc } from '@/lib/orpc';
import { RequirePermissions } from './require-permissions';

type SubjectExam = { sessionId: string; examSlug: string };

/** The stored subject of a slug, read as an own key so slugs such as `constructor` work. */
function storedSubject(classData: ClassDto, slug: string | undefined) {
  return slug !== undefined && Object.hasOwn(classData.config.subjects, slug) ? classData.config.subjects[slug] : undefined;
}

/**
 * Saves the classroom subject dialog, one subject at a time so a subject
 * someone else added meanwhile is never overwritten. A new subject is added
 * with `addClassSubject` as a classroom subject (the server creates its plans
 * in the examinations the class takes part in, refusing without permission to
 * create exam plans). An edit uses `updateClassSubject`: name and modes, and a
 * new slug as a rename, which the server refuses while the subject has plans.
 */
function useSaveSubject(classData: ClassDto, schoolId: string, originalSlug: string | undefined) {
  const invalidate = useInvalidateClass(schoolId, classData.id);
  return async (value: SubjectFormValue) => {
    const existing = storedSubject(classData, originalSlug);
    if (value.slug !== originalSlug && storedSubject(classData, value.slug)) {
      throw new Error('A subject with this slug already exists.');
    }
    if (!existing || originalSlug === undefined) {
      await client.school.addClassSubject({
        schoolId,
        classId: classData.id,
        slug: value.slug,
        name: value.name,
        examModes: examModesOf(value),
        attachment: { kind: 'school' },
      });
    } else {
      await client.school.updateClassSubject({
        schoolId,
        classId: classData.id,
        subjectSlug: originalSlug,
        slug: value.slug === originalSlug ? undefined : value.slug,
        name: value.name,
        examModes: examModesOf(value),
      });
    }
    await invalidate();
  };
}

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
  const existing = storedSubject(classData, originalSlug);
  const save = useSaveSubject(classData, schoolId, originalSlug);
  const form = useSubjectForm({
    defaultValues: existing && originalSlug ? subjectFormValueOf(originalSlug, existing) : newSubjectFormValue(),
    onSubmit: async (value) => {
      await save(value);
      onClose();
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
          <SubjectFormFields form={form} />
          <SubjectDialogFooter form={form} editing={existing !== undefined} onClose={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubjectDialogFooter({ form, editing, onClose }: { form: SubjectForm; editing: boolean; onClose: () => void }) {
  return (
    <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, errors: state.errors, isSubmitting: state.isSubmitting })}>
      {({ canSubmit, errors, isSubmitting }) => (
        <>
          <SubjectFormMessages errors={errors} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Saving…' : editing ? 'Save subject' : 'Create subject'}</Button>
          </DialogFooter>
        </>
      )}
    </form.Subscribe>
  );
}

/** "Only for Term 1": the examination an exam-only subject was added for, read from its session's settings. */
function ExamOnlyBadge({ schoolId, exam }: { schoolId: string; exam: SubjectExam }) {
  return (
    <RequirePermissions
      permissions={{ action: SCHOOL_ACTIONS.READ_SESSION, resource: { kind: 'school', schoolId } }}
      fallback={<Badge variant="secondary">Only for one examination</Badge>}
      pending={<Badge variant="secondary">Only for one examination</Badge>}
    >
      <ExamOnlyBadgeName schoolId={schoolId} exam={exam} />
    </RequirePermissions>
  );
}

function ExamOnlyBadgeName({ schoolId, exam }: { schoolId: string; exam: SubjectExam }) {
  const session = useQuery(orpc.school.getSession.queryOptions({ input: { schoolId, sessionId: exam.sessionId } }));
  const config = session.data?.sessionConfig?.examConfig;
  const name = config && Object.hasOwn(config, exam.examSlug) ? config[exam.examSlug]!.name : undefined;
  return <Badge variant="secondary">{name ? `Only for ${name}` : 'Only for one examination'}</Badge>;
}

/**
 * Move to classroom, for an exam-only subject. It may create plans in the
 * other examinations the class takes part in, so it needs permission to
 * create exam plans as well as the class configuration grant.
 */
function MoveToClassroomButton({ schoolId, name, onMove }: { schoolId: string; name: string; onMove: () => void }) {
  return (
    <RequirePermissions
      permissions={[
        { action: SCHOOL_ACTIONS.UPDATE_CLASS_CONFIGURATION, resource: { kind: 'school', schoolId } },
        { action: SCHOOL_ACTIONS.CREATE_EXAM_PLAN, resource: { kind: 'school', schoolId } },
      ]}
    >
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${name} to the classroom`} title="Move to classroom" onClick={onMove}>
        <ArrowUpRight aria-hidden />
      </Button>
    </RequirePermissions>
  );
}

/**
 * Editing or deleting a subject saves the class configuration, so it needs
 * that grant; an exam-only subject also offers Move to classroom, with its
 * own gate.
 */
function SubjectRowActions({
  schoolId,
  name,
  examOnly,
  onEdit,
  onDelete,
  onMove,
}: {
  schoolId: string;
  name: string;
  examOnly: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 pr-2">
      {examOnly && <MoveToClassroomButton schoolId={schoolId} name={name} onMove={onMove} />}
      <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.UPDATE_CLASS_CONFIGURATION, resource: { kind: 'school', schoolId } }}>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${name}`} onClick={onEdit}><Pencil aria-hidden /></Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${name}`} onClick={onDelete}><Trash2 aria-hidden /></Button>
      </RequirePermissions>
    </div>
  );
}

/** Adding a subject saves the class configuration, so it needs that grant. */
function AddSubjectButton({ schoolId, onAdd, variant = 'default' }: { schoolId: string; onAdd: () => void; variant?: 'default' | 'outline' }) {
  return (
    <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.UPDATE_CLASS_CONFIGURATION, resource: { kind: 'school', schoolId } }}>
      <Button type="button" variant={variant} onClick={onAdd}><Plus aria-hidden /> Add subject</Button>
    </RequirePermissions>
  );
}

function NoSubjects({ schoolId, onAdd }: { schoolId: string; onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
      <p>No subjects have been added yet.</p>
      <AddSubjectButton schoolId={schoolId} onAdd={onAdd} variant="outline" />
    </div>
  );
}

/** One subject of the classroom: its name and slug, where it is offered, its books and exam modes. */
function SubjectItem({
  schoolId,
  slug,
  subject,
  onEdit,
  onDelete,
  onMove,
}: {
  schoolId: string;
  slug: string;
  subject: ClassDto['config']['subjects'][string];
  onEdit: () => void;
  onDelete: () => void;
  onMove: () => void;
}) {
  const modeCount = Object.keys(subject.examModes).length;
  return (
    <AccordionItem value={slug}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center">
        <AccordionTrigger className="min-w-0 items-center gap-3">
          <span className="min-w-0 flex-1 break-words">{subject.name} <span className="font-normal text-muted-foreground">({slug})</span></span>
          <span className="hidden shrink-0 text-xs font-normal text-muted-foreground sm:inline">
            {subject.books.length} {subject.books.length === 1 ? 'book' : 'books'} · {modeCount} {modeCount === 1 ? 'exam mode' : 'exam modes'}
          </span>
        </AccordionTrigger>
        <SubjectRowActions schoolId={schoolId} name={subject.name} examOnly={subject.attachment.kind === 'exam'} onEdit={onEdit} onDelete={onDelete} onMove={onMove} />
      </div>
      <AccordionContent className="flex flex-col gap-5 border-t pt-4">
        {subject.attachment.kind === 'exam' && (
          <div className="flex flex-wrap items-center gap-2">
            {subject.attachment.exams.map((exam) => <ExamOnlyBadge key={`${exam.sessionId}:${exam.examSlug}`} schoolId={schoolId} exam={exam} />)}
            <p className="text-xs text-muted-foreground">Added from an examination; not one of the classroom&apos;s own subjects.</p>
          </div>
        )}
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
  );
}

/** Refreshes what a subject change can alter: the class, the class list and the examinations' plans. */
function useInvalidateClass(schoolId: string, classId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.school.getClass.queryKey({ input: { schoolId, classId } }) }),
      queryClient.invalidateQueries({ queryKey: orpc.school.listClasses.key() }),
      // Adding a subject or moving one to the classroom can add plans to the
      // examinations the class takes part in: every exam read showing plans.
      ...[
        orpc.school.getExamPlanPreview,
        orpc.school.listExamPlans,
        orpc.school.getExamContext,
        orpc.school.getExamOverview,
        orpc.school.listExamClasses,
        orpc.school.listExams,
      ].map((procedure) => queryClient.invalidateQueries({ queryKey: procedure.key() })),
    ]);
}

export function ClassSubjects({ classId, schoolId }: { classId: string; schoolId: string }) {
  const [editingSlug, setEditingSlug] = useState<string | null>();
  const [deleteSlug, setDeleteSlug] = useState<string>();
  const [moveSlug, setMoveSlug] = useState<string>();
  const invalidate = useInvalidateClass(schoolId, classId);
  const classQuery = useQuery(orpc.school.getClass.queryOptions({ input: { schoolId, classId } }));
  const deleteMutation = useMutation({
    // One subject, so a subject someone else added meanwhile stays; refused while it has plans.
    mutationFn: (subjectSlug: string) => client.school.removeClassSubject({ schoolId, classId, subjectSlug }),
    onSuccess: async () => {
      setDeleteSlug(undefined);
      await invalidate();
    },
  });
  const moveMutation = useMutation({
    mutationFn: (subjectSlug: string) => client.school.moveClassSubjectToClassroom({ schoolId, classId, subjectSlug }),
    onSuccess: async () => {
      setMoveSlug(undefined);
      await invalidate();
    },
  });

  if (classQuery.isPending) return <Skeleton className="h-72 w-full rounded-xl" />;
  if (!classQuery.data) return <p className="text-sm text-destructive">Unable to load subjects.</p>;
  const subjects = Object.entries(classQuery.data.config.subjects);
  const classroomCount = subjects.filter(([, subject]) => subject.attachment.kind === 'school').length;
  const examOnlyCount = subjects.length - classroomCount;
  const moving = storedSubject(classQuery.data, moveSlug);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Subjects &amp; exam modes</h2>
          <p className="text-sm text-muted-foreground">
            {classroomCount} {classroomCount === 1 ? 'subject' : 'subjects'}
            {examOnlyCount ? ` · ${examOnlyCount} only for an examination` : ''}
          </p>
        </div>
        <AddSubjectButton schoolId={schoolId} onAdd={() => setEditingSlug(null)} />
      </div>
      {subjects.length ? (
        <Accordion type="multiple" className="rounded-xl bg-card">
          {subjects.map(([slug, subject]) => (
            <SubjectItem
              key={slug}
              schoolId={schoolId}
              slug={slug}
              subject={subject}
              onEdit={() => setEditingSlug(slug)}
              onDelete={() => setDeleteSlug(slug)}
              onMove={() => setMoveSlug(slug)}
            />
          ))}
        </Accordion>
      ) : <NoSubjects schoolId={schoolId} onAdd={() => setEditingSlug(null)} />}
      {editingSlug !== undefined ? <SubjectDialog key={editingSlug ?? 'new'} classData={classQuery.data} originalSlug={editingSlug ?? undefined} schoolId={schoolId} onClose={() => setEditingSlug(undefined)} /> : null}
      <ConfirmationDialog
        open={moving !== undefined}
        title={`Move ${moving?.name ?? 'this subject'} to the classroom?`}
        description="It becomes one of the classroom's subjects, offered in every examination of this class, and gets a plan in each examination the class takes part in that can still change. Its plans, marks and question papers stay."
        confirmLabel={moveMutation.isPending ? 'Moving…' : 'Move to classroom'}
        confirmVariant="default"
        pending={moveMutation.isPending}
        onOpenChange={(open) => {
          if (!open) {
            setMoveSlug(undefined);
            moveMutation.reset();
          }
        }}
        onConfirm={() => moveSlug && moveMutation.mutate(moveSlug)}
      >
        {moveMutation.error ? <p role="alert" className="text-xs text-destructive">{moveMutation.error instanceof Error ? moveMutation.error.message : 'Unable to move this subject.'}</p> : null}
      </ConfirmationDialog>
      <AlertDialog open={deleteSlug !== undefined} onOpenChange={(open) => !open && !deleteMutation.isPending && setDeleteSlug(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete this subject?</AlertDialogTitle><AlertDialogDescription>This removes its books and exam-mode configuration from the classroom. A subject with exam plans cannot be deleted; delete its plans first.</AlertDialogDescription></AlertDialogHeader>
          {deleteMutation.error ? <p className="text-xs text-destructive">{deleteMutation.error instanceof Error ? deleteMutation.error.message : 'Unable to delete this subject.'}</p> : null}
          <AlertDialogFooter><AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel><Button type="button" variant="destructive" disabled={!deleteSlug || deleteMutation.isPending} onClick={() => deleteSlug && deleteMutation.mutate(deleteSlug)}>{deleteMutation.isPending ? 'Deleting…' : 'Delete subject'}</Button></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

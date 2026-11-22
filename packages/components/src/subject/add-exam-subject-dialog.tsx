'use client';

import { useId } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Button } from '@campuspilot/ui/components/button';
import { Checkbox } from '@campuspilot/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import { Label } from '@campuspilot/ui/components/label';
import { SubjectFormFields, SubjectFormMessages, useSubjectForm, type SubjectForm } from './subject-form';
import { newSubjectFormValue, type SubjectFormValue } from './subject-form-model';

/**
 * A subject added from an examination, and whether it is also added to the
 * classroom. `alsoClassroom` is false unless the person ticks it: the subject
 * is then offered only in this examination.
 */
export type AddExamSubjectValue = SubjectFormValue & { alsoClassroom: boolean };

const placementSchema = z.object({ alsoClassroom: z.boolean() });

function usePlacementForm() {
  return useForm({
    defaultValues: { alsoClassroom: false },
    validators: { onChange: placementSchema },
  });
}

/**
 * Add subject from an examination (the Create plan review and the classes
 * taking part): name, generated slug, exam modes and "Also add to the
 * classroom", unchecked by default. Presentational: the caller saves through
 * `onSubmit` (a rejection is shown in the dialog) and unmounts the dialog in
 * `onClose`, so each opening starts empty.
 */
export function AddExamSubjectDialog({
  className,
  examName,
  onClose,
  onSubmit,
}: {
  className: string;
  examName: string;
  onClose: () => void;
  onSubmit: (value: AddExamSubjectValue) => Promise<void>;
}) {
  const placement = usePlacementForm();
  const form = useSubjectForm({
    defaultValues: newSubjectFormValue(),
    onSubmit: (value) => onSubmit({ ...value, alsoClassroom: placement.state.values.alsoClassroom }),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add subject to {className}</DialogTitle>
          <DialogDescription>
            The subject is added only for {examName} unless you also add it to the classroom.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto pr-1"
          onSubmit={(event) => {
            // The dialog may be rendered inside another form's React tree.
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <SubjectFormFields form={form} />
          <AlsoClassroomField placement={placement} />
          <AddExamSubjectFooter form={form} onClose={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AlsoClassroomField({ placement }: { placement: ReturnType<typeof usePlacementForm> }) {
  const id = useId();
  return (
    <placement.Field name="alsoClassroom">
      {(field) => (
        <div className="flex items-start gap-3 rounded-lg border p-3">
          <Checkbox id={id} checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked === true)} />
          <div className="flex flex-col gap-1">
            <Label htmlFor={id}>Also add to the classroom</Label>
            <p className="text-xs text-muted-foreground">
              The subject then belongs to the class and joins every examination it takes part in.
            </p>
          </div>
        </div>
      )}
    </placement.Field>
  );
}

function AddExamSubjectFooter({ form, onClose }: { form: SubjectForm; onClose: () => void }) {
  return (
    <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, errors: state.errors, isSubmitting: state.isSubmitting })}>
      {({ canSubmit, errors, isSubmitting }) => (
        <>
          <SubjectFormMessages errors={errors} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? 'Adding…' : 'Add subject'}
            </Button>
          </DialogFooter>
        </>
      )}
    </form.Subscribe>
  );
}

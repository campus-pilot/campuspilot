'use client';

import { useId } from 'react';
import { useForm } from '@tanstack/react-form';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import {
  errorMessages,
  followingSlug,
  subjectFormSchema,
  type SubjectFormValue,
} from './subject-form-model';

/**
 * The TanStack Form behind every subject editor (the classroom's subject
 * dialog, Add subject from an examination), validated with
 * {@link subjectFormSchema} on submit. `onSubmit` receives the parsed
 * (trimmed) value; a rejection is shown as the form's error, so the caller
 * only saves through its own callback and never handles input state.
 */
export function useSubjectForm({
  defaultValues,
  onSubmit,
}: {
  defaultValues: SubjectFormValue;
  onSubmit: (value: SubjectFormValue) => Promise<void>;
}) {
  return useForm({
    defaultValues,
    validators: { onSubmit: subjectFormSchema },
    onSubmit: async ({ value, formApi }) => {
      formApi.setErrorMap({});
      try {
        await onSubmit(subjectFormSchema.parse(value));
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            form: error instanceof Error ? error.message : 'Unable to save this subject.',
            fields: {},
          },
        });
      }
    },
  });
}

export type SubjectForm = ReturnType<typeof useSubjectForm>;

/** Error messages beside a field or under the form. */
export function SubjectFormMessages({ errors }: { errors: readonly unknown[] }) {
  return errorMessages(errors).map((message) => (
    <p key={message} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  ));
}

/**
 * The fields of a subject: name, slug (generated from the name until edited)
 * and exam modes with their percentages. `slugLocked` keeps the slug as it
 * is, for a subject whose slug must not change here.
 */
export function SubjectFormFields({ form, slugLocked = false }: { form: SubjectForm; slugLocked?: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <SubjectNameField form={form} slugLocked={slugLocked} />
        <SubjectSlugField form={form} locked={slugLocked} />
      </div>
      <ExamModesField form={form} />
    </div>
  );
}

function SubjectNameField({ form, slugLocked }: { form: SubjectForm; slugLocked: boolean }) {
  const id = useId();
  return (
    <form.Field name="name">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor={id}>Subject name</Label>
          <Input
            id={id}
            autoFocus
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) => {
              const next = event.target.value;
              if (!slugLocked) form.setFieldValue('slug', followingSlug(field.state.value, next, form.getFieldValue('slug')));
              field.handleChange(next);
            }}
          />
          <SubjectFormMessages errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}

function SubjectSlugField({ form, locked }: { form: SubjectForm; locked: boolean }) {
  const id = useId();
  return (
    <form.Field name="slug">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor={id}>Slug</Label>
          <Input
            id={id}
            value={field.state.value}
            readOnly={locked}
            aria-describedby={`${id}-hint`}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
          />
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {locked ? 'The slug of this subject cannot change here.' : 'Generated from the name. Plans and marks refer to it.'}
          </p>
          <SubjectFormMessages errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}

function ExamModesField({ form }: { form: SubjectForm }) {
  return (
    <form.Field name="examModes" mode="array">
      {(modesField) => {
        const total = modesField.state.value.reduce((sum, mode) => sum + (Number(mode.percentage) || 0), 0);
        return (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label>Exam modes</Label>
              <p className="text-xs text-muted-foreground">Percentages must sum to 100%.</p>
            </div>
            {modesField.state.value.map((mode, index) => (
              <ExamModeRow
                key={index}
                form={form}
                index={index}
                label={mode.name || `mode ${index + 1}`}
                removable={modesField.state.value.length > 1}
                onRemove={() => modesField.removeValue(index)}
              />
            ))}
            <Button type="button" variant="outline" onClick={() => modesField.pushValue({ name: '', slug: '', percentage: 0 })}>
              <Plus aria-hidden /> Add exam mode
            </Button>
            <p className={total === 100 ? 'text-xs text-emerald-600' : 'text-xs text-destructive'}>Total: {total}%</p>
            <SubjectFormMessages errors={modesField.state.meta.errors} />
          </div>
        );
      }}
    </form.Field>
  );
}

function ExamModeRow({
  form,
  index,
  label,
  removable,
  onRemove,
}: {
  form: SubjectForm;
  index: number;
  label: string;
  removable: boolean;
  onRemove: () => void;
}) {
  const id = useId();
  return (
    <div className="grid items-start gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_7rem_auto]">
      <form.Field name={`examModes[${index}].name`}>
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input id={`${id}-name`} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
            <SubjectFormMessages errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name={`examModes[${index}].slug`}>
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-slug`}>Slug</Label>
            <Input id={`${id}-slug`} value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
            <SubjectFormMessages errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name={`examModes[${index}].percentage`}>
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-percentage`}>Percent</Label>
            <Input
              id={`${id}-percentage`}
              type="number"
              min={0}
              max={100}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.valueAsNumber)}
            />
            <SubjectFormMessages errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <Button type="button" variant="ghost" size="icon-sm" className="mt-6" aria-label={`Remove ${label}`} disabled={!removable} onClick={onRemove}>
        <Trash2 aria-hidden />
      </Button>
    </div>
  );
}

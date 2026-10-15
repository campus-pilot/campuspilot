'use client';
import { toast } from '@campuspilot/ui/lib/toast';
import { useForm } from '@tanstack/react-form';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { client, orpc } from '@/lib/orpc';
import {
  DirtyGuard,
  ExamButton,
  ExamInput,
  Issues,
  Notice,
  submitExam,
  useExamCache,
} from './exam-common';
import {
  errorCode,
  errorMessage,
  examHref,
  numericText,
  type SessionScope,
} from './exam-model';

const schema = z.object({
  name: z.string().trim().min(1, 'Exam name is required').max(200),
  slug: z.string().trim().min(1, 'Exam code is required').max(100),
  order: numericText.refine(
    (value) => Number.isInteger(Number(value)) && Number(value) > 0,
    'Enter a positive whole number',
  ),
  slugEdited: z.boolean(),
  duplicate: z.boolean(),
});
function useExamDefinitionForm({
  scope,
  exam,
  onClose,
  active,
}: {
  scope: SessionScope;
  exam?: { slug: string; name: string; order: number };
  onClose: () => void;
  active: boolean;
}) {
  const router = useRouter();
  const queries = useExamCache();
  const form = useForm({
    defaultValues: {
      name: exam?.name ?? '',
      slug: exam?.slug ?? '',
      order: String(exam?.order ?? 1),
      slugEdited: false,
      duplicate: false,
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      if (!active) {
        form.setErrorMap({
          onSubmit: { form: 'This session is read-only.', fields: {} },
        });
        return;
      }
      try {
        const data = schema.parse(value);
        const saved = exam
          ? await client.school.updateExam({
              ...scope,
              examSlug: exam.slug,
              name: data.name,
              order: Number(data.order),
            })
          : await client.school.createExam({
              ...scope,
              examSlug: data.slug,
              name: data.name,
              order: Number(data.order),
            });
        queries.cache.setQueryData(
          orpc.school.getExam.queryKey({
            input: { ...scope, examSlug: saved.slug },
          }),
          saved,
        );
        form.reset({
          name: saved.name,
          slug: saved.slug,
          order: String(saved.order),
          slugEdited: false,
          duplicate: false,
        });
        await queries.definitions(scope, saved.slug);
        toast.success(exam ? 'Exam saved.' : 'Exam created.');
        onClose();
        if (!exam) router.push(examHref(scope, saved.slug));
      } catch (error) {
        form.setErrorMap({
          onSubmit: { form: errorMessage(error), fields: {} },
        });
        form.setFieldValue('duplicate', errorCode(error) === 'CONFLICT');
        await queries.definitions(scope, value.slug);
      }
    },
  });
  return { form };
}

export function ExamDefinitionForm({
  scope,
  exam,
  onClose,
  active,
}: {
  scope: SessionScope;
  exam?: { slug: string; name: string; order: number };
  onClose: () => void;
  active: boolean;
}) {
  const { form } = useExamDefinitionForm({ scope, exam, onClose, active });
  return (
    <section className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-lg font-semibold">
        {exam ? 'Edit exam' : 'Create exam'}
      </h2>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => submitExam(event, form.handleSubmit)}
      >
        <form.Field name="name">
          {(field) => (
            <ExamInput
              field={{
                name: field.name,
                state: field.state,
                handleBlur: field.handleBlur,
                handleChange: (value) => {
                  field.handleChange(value);
                  if (!form.getFieldValue('slugEdited') && !exam)
                    form.setFieldValue(
                      'slug',
                      value
                        .trim()
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/^-|-$/g, ''),
                    );
                },
              }}
              label="Exam name"
              autoComplete="off"
            />
          )}
        </form.Field>
        <form.Field name="slug">
          {(field) => (
            <ExamInput
              field={{
                name: field.name,
                state: field.state,
                handleBlur: field.handleBlur,
                handleChange: (value) => {
                  field.handleChange(value);
                  form.setFieldValue('slugEdited', true);
                },
              }}
              label="Exam code"
              readOnly={!!exam}
            />
          )}
        </form.Field>
        <p className="text-sm text-muted-foreground">
          A unique code within this session, used in links. It cannot be renamed
          after creation.
        </p>
        <form.Field name="order">
          {(field) => (
            <ExamInput
              field={field}
              label="Display order"
              inputMode="numeric"
            />
          )}
        </form.Field>
        <form.Subscribe
          selector={(state) => ({
            dirty: state.isDirty,
            submitting: state.isSubmitting,
            canSubmit: state.canSubmit,
            errors: state.errors,
            duplicate: state.values.duplicate,
          })}
        >
          {({ dirty, submitting, canSubmit, errors, duplicate }) => (
            <>
              <DirtyGuard dirty={dirty} />
              <Issues errors={errors} />
              {duplicate && !exam && (
                <Notice>
                  <a
                    className="underline"
                    href={examHref(scope, form.getFieldValue('slug').trim())}
                  >
                    Open existing exam
                  </a>
                </Notice>
              )}
              <div className="flex flex-wrap gap-3">
                <ExamButton
                  type="submit"
                  disabled={!active || !canSubmit || submitting}
                >
                  {submitting ? 'Saving…' : exam ? 'Save exam' : 'Create exam'}
                </ExamButton>
                <ExamButton
                  type="button"
                  variant="outline"
                  disabled={submitting}
                  onClick={() => {
                    if (
                      !dirty ||
                      window.confirm('Discard unsaved exam changes?')
                    )
                      onClose();
                  }}
                >
                  Cancel
                </ExamButton>
              </div>
            </>
          )}
        </form.Subscribe>
      </form>
    </section>
  );
}

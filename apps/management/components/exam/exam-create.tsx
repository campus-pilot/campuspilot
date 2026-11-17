'use client';
import { useState, type ReactNode } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { isExamSlugTakenError } from '@campuspilot/api/routers/school/exam/exam-definition.contract';
import { Button } from '@campuspilot/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import { toast } from '@campuspilot/ui/lib/toast';
import { RequirePermissions } from '@/components/require-permissions';
import { client, orpc } from '@/lib/orpc';
import { ExamInput, Issues } from './exam-common';
import {
  createExamFormSchema,
  emptyCreateExamForm,
  followNameSlug,
  toCreateExamInput,
} from './exam-create-model';
import {
  errorMessage,
  isExamSaveUncertain,
  schoolPermission,
  type SessionScope,
} from './exam-model';

/**
 * The Examinations list's single Create examination action (navbar and empty
 * state). It needs the permission `school.createExam` checks, and is offered
 * only while the session is known to be active: the server refuses other
 * sessions, and a denied or failed session read keeps it closed, as every
 * other examination mutation does (`ExamSession`).
 */
export function CreateExamAction({
  scope,
  variant = 'default',
}: {
  scope: SessionScope;
  variant?: 'default' | 'outline';
}) {
  return (
    <RequirePermissions
      permissions={[
        schoolPermission(scope.schoolId, SCHOOL_ACTIONS.CREATE_EXAM),
        schoolPermission(scope.schoolId, SCHOOL_ACTIONS.READ_SESSION),
      ]}
    >
      <WhileSessionActive scope={scope}>
        <CreateExamButton scope={scope} variant={variant} />
      </WhileSessionActive>
    </RequirePermissions>
  );
}

/** Renders its children only while the held session data says it is active. */
function WhileSessionActive({
  scope,
  children,
}: {
  scope: SessionScope;
  children: ReactNode;
}) {
  const query = useQuery(orpc.school.getSession.queryOptions({ input: scope }));
  return query.data?.isActive === true ? children : null;
}

function CreateExamButton({
  scope,
  variant,
}: {
  scope: SessionScope;
  variant: 'default' | 'outline';
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={variant}
        onClick={() => setOpen(true)}
      >
        <Plus aria-hidden />
        Create examination
      </Button>
      {open ? (
        <CreateExamDialog scope={scope} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

/**
 * Refreshes every read that shows the session's exams: the Examinations list
 * (every page and order, and the command palette's copy), the session read by
 * session settings and the exam screens, and the sessions list.
 */
function useRefreshSessionExams(scope: SessionScope) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      [
        orpc.school.listExams.key({ input: scope }),
        orpc.school.getSession.key({ input: scope }),
        orpc.school.listSessions.key({ input: { schoolId: scope.schoolId } }),
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
}

/**
 * The form behind the dialog. The server's taken-slug refusal (identified by
 * its explicit reason, not by CONFLICT, which also covers database conflicts)
 * is shown beside the slug field; any other refusal above the buttons. When the outcome is unknown (a
 * network or server failure after the request left), the list is refreshed
 * and the message says to check it before trying again: a retry of a
 * committed creation is refused as a duplicate, never created twice.
 */
function useCreateExamForm(scope: SessionScope, onClose: () => void) {
  const refresh = useRefreshSessionExams(scope);
  const form = useForm({
    defaultValues: emptyCreateExamForm,
    validators: { onChange: createExamFormSchema },
    onSubmit: async ({ value }) => {
      // A refusal from the previous attempt is not this attempt's answer.
      form.setErrorMap({ onSubmit: undefined });
      try {
        const exam = await client.school.createExam(
          toCreateExamInput(scope, value),
        );
        await refresh();
        toast.success(`${exam.name} created.`);
        onClose();
      } catch (error) {
        if (isExamSlugTakenError(error)) {
          // Validates the form, which puts the refusal beside the slug field.
          form.setFieldValue('takenSlugs', [
            ...value.takenSlugs,
            value.slug.trim(),
          ]);
          return;
        }
        if (isExamSaveUncertain(error)) await refresh();
        form.setErrorMap({
          onSubmit: {
            form: isExamSaveUncertain(error)
              ? 'The examination may not have been created. Check the list before trying again.'
              : errorMessage(error),
            fields: {},
          },
        });
      }
    },
  });
  return form;
}

function CreateExamDialog({
  scope,
  onClose,
}: {
  scope: SessionScope;
  onClose: () => void;
}) {
  const form = useCreateExamForm(scope, onClose);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create examination</DialogTitle>
          <DialogDescription>
            The examination is added to this session&apos;s settings and listed
            after the existing ones.
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
          <form.Field name="name">
            {(field) => (
              <ExamInput
                label="Exam name"
                placeholder="e.g. Unit Test 1"
                autoFocus
                field={{
                  name: field.name,
                  state: field.state,
                  handleBlur: field.handleBlur,
                  handleChange: (nextName) => {
                    form.setFieldValue(
                      'slug',
                      followNameSlug({
                        previousName: field.state.value,
                        nextName,
                        slug: form.getFieldValue('slug'),
                      }),
                    );
                    field.handleChange(nextName);
                  },
                }}
              />
            )}
          </form.Field>
          <form.Field name="slug">
            {(field) => (
              <div className="flex flex-col gap-1">
                <ExamInput
                  label="Identifier (slug)"
                  placeholder="e.g. unit_test_1"
                  field={field}
                />
                <p className="text-xs text-muted-foreground">
                  Unique in this session. Lowercase letters, numbers and
                  underscores.
                </p>
              </div>
            )}
          </form.Field>
          <CreateExamFooter form={form} onClose={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateExamFooter({
  form,
  onClose,
}: {
  form: ReturnType<typeof useCreateExamForm>;
  onClose: () => void;
}) {
  return (
    <form.Subscribe
      selector={(state) => ({
        // Fields, not the whole form: the form-level message of a refused or
        // uncertain attempt must not block trying again with the same values.
        // The next submission clears that message before it runs.
        canSubmit: state.isFieldsValid && !state.isValidating,
        isSubmitting: state.isSubmitting,
        errors: state.errors,
      })}
    >
      {({ canSubmit, isSubmitting, errors }) => (
        <>
          <Issues errors={errors} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create examination'}
            </Button>
          </DialogFooter>
        </>
      )}
    </form.Subscribe>
  );
}

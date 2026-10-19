'use client';
import Link from 'next/link';
import {
  documentWorkspaceHref,
  documentWorkspacePermissions,
} from '@/components/documents/document-export-link';
import { TimetablePreview } from '@campuspilot/components/exam/timetable-preview';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { toast } from '@campuspilot/ui/lib/toast';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
} from '@campuspilot/ui/components/empty';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { FileDown, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import {
  saveExamTimetableInputSchema,
  type ExamContextDto,
} from '@campuspilot/api/routers/school/exam/exam.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@campuspilot/ui/components/dropdown-menu';
import { client, orpc } from '@/lib/orpc';
import {
  ExamButton,
  Issues,
  LoadingExam,
  Notice,
  ReadError,
  useExamCache,
} from './exam-common';
import { errorMessage, schoolPermission, type ExamScope } from './exam-model';

import { TimetableEditor } from './exam-timetable-editor';

type Config = z.infer<typeof saveExamTimetableInputSchema>['config'];

export function ExamTimetable({
  scope,
  context,
  active,
}: {
  scope: ExamScope;
  context: ExamContextDto;
  active: boolean;
}) {
  const query = useQuery(
    orpc.school.getExamTimetable.queryOptions({ input: scope }),
  );
  if (query.isPending) return <LoadingExam />;
  if (query.isError && query.data === undefined)
    return <ReadError error={query.error} retry={query.refetch} />;
  return (
    <div className="flex flex-col gap-4">
      {query.isError && <ReadError error={query.error} retry={query.refetch} />}
      {query.data == null ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No timetable yet</EmptyTitle>
          </EmptyHeader>
          <RequirePermissions
            permissions={schoolPermission(
              scope.schoolId,
              SCHOOL_ACTIONS.READ_EXAM_PLANS,
            )}
            fallback={
              <Notice>
                Plan status is unavailable. Timetable editing is closed.
              </Notice>
            }
          >
            <TimetableActions
              scope={scope}
              context={context}
              active={active && !query.isError}
            />
          </RequirePermissions>
        </Empty>
      ) : (
        <TimetablePreview
          config={query.data.config}
          classes={context.classes}
        />
      )}
    </div>
  );
}

/** Populated timetable actions belong in the examination workspace header. */
export function ExamTimetableMenu({
  scope,
  context,
  active,
}: {
  scope: ExamScope;
  context: ExamContextDto;
  active: boolean;
}) {
  return (
    <RequirePermissions
      permissions={schoolPermission(
        scope.schoolId,
        SCHOOL_ACTIONS.READ_EXAM_PLANS,
      )}
    >
      <TimetableActions
        scope={scope}
        context={context}
        active={active}
        placement="menu"
      />
    </RequirePermissions>
  );
}

function TimetableActions({
  scope,
  context,
  active,
  placement = 'page',
}: {
  scope: ExamScope;
  context: ExamContextDto;
  active: boolean;
  placement?: 'page' | 'menu';
}) {
  const completed = useQuery(
    orpc.school.listExamPlans.queryOptions({
      input: { ...scope, page: 1, limit: 1, filters: { status: 'completed' } },
    }),
  );
  const timetable = useQuery(
    orpc.school.getExamTimetable.queryOptions({ input: scope }),
  );
  const queries = useExamCache();
  const form = useForm({
    defaultValues: {
      editing: false,
      baseline: null as Config | null,
      version: '',
      editorKey: 0,
      error: '',
      confirmingDelete: false,
    },
    validators: {
      onChange: z.object({
        editing: z.boolean(),
        baseline: saveExamTimetableInputSchema.shape.config.nullable(),
        version: z.string(),
        editorKey: z.number(),
        error: z.string(),
        confirmingDelete: z.boolean(),
      }),
    },
    onSubmit: async () => {
      try {
        await client.school.deleteExamTimetable(scope);
        queries.cache.setQueryData(
          orpc.school.getExamTimetable.queryKey({ input: scope }),
          null,
        );
        form.setFieldValue('confirmingDelete', false);
        toast.success('Timetable deleted.');
      } catch (error) {
        form.setErrorMap({
          onSubmit: { form: errorMessage(error), fields: {} },
        });
        await timetable.refetch();
      }
    },
  });
  const editable =
    active &&
    !completed.isPending &&
    !completed.isFetching &&
    !completed.isError &&
    completed.data.pagination.totalItems === 0 &&
    !timetable.isError;
  const open = async () => {
    const result = await timetable.refetch();
    if (result.isError) {
      form.setFieldValue('error', errorMessage(result.error));
      if (placement !== 'page') toast.error(errorMessage(result.error));
      return;
    }
    form.setFieldValue('error', '');
    form.setFieldValue(
      'baseline',
      result.data?.config ?? {
        columns: context.classes.map((item) => item.id),
        rows: [],
      },
    );
    form.setFieldValue('version', result.data?.updatedAt?.toISOString() ?? '');
    form.setFieldValue('editorKey', form.getFieldValue('editorKey') + 1);
    form.setFieldValue('editing', true);
  };
  return (
    <form.Subscribe
      selector={(state) => ({
        values: state.values,
        pending: state.isSubmitting,
        errors: state.errors,
      })}
    >
      {({ values, pending, errors }) => (
        <>
          {placement === 'page' && completed.isError && (
            <ReadError error={completed.error} retry={completed.refetch} />
          )}
          {placement === 'page' &&
            !editable &&
            !completed.isPending &&
            !completed.isFetching && (
              <Notice>
                {completed.data?.pagination.totalItems
                  ? 'The examination is completed. Reopen result entry to edit the timetable.'
                  : 'Timetable is read-only.'}
              </Notice>
            )}
          <RequirePermissions
            permissions={schoolPermission(
              scope.schoolId,
              SCHOOL_ACTIONS.UPDATE_EXAM_TIMETABLE,
            )}
          >
            {values.editing && values.baseline ? (
              <TimetableEditor
                key={values.editorKey}
                scope={scope}
                context={context}
                initial={values.baseline}
                editable={editable}
                newer={
                  values.version !==
                  (timetable.data?.updatedAt?.toISOString() ?? '')
                }
                onReload={open}
                onClose={() => form.setFieldValue('editing', false)}
              />
            ) : editable && placement === 'page' && !timetable.data ? (
              <ExamButton
                size={
                  placement === 'page' && !timetable.data ? 'sm' : 'default'
                }
                onClick={() => {
                  void open();
                }}
              >
                {timetable.data ? 'Edit timetable' : 'Create timetable'}
              </ExamButton>
            ) : null}
          </RequirePermissions>
          {placement === 'page' && values.error && (
            <Notice error>{values.error}</Notice>
          )}
          {placement === 'menu' && timetable.data && !values.editing && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <ExamButton
                    variant="ghost"
                    size="icon"
                    aria-label="Timetable actions"
                  >
                    <MoreVertical aria-hidden />
                  </ExamButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    {editable && (
                      <RequirePermissions
                        permissions={schoolPermission(
                          scope.schoolId,
                          SCHOOL_ACTIONS.UPDATE_EXAM_TIMETABLE,
                        )}
                      >
                        <DropdownMenuItem
                          onSelect={() => {
                            void open();
                          }}
                        >
                          <Pencil aria-hidden />
                          Edit timetable
                        </DropdownMenuItem>
                      </RequirePermissions>
                    )}
                    <RequirePermissions
                      permissions={documentWorkspacePermissions(
                        scope.schoolId,
                        'timetable',
                      )}
                    >
                      <DropdownMenuItem asChild>
                        <Link
                          href={documentWorkspaceHref({
                            scope,
                            type: 'timetable',
                            examSlug: scope.examSlug,
                          })}
                        >
                          <FileDown aria-hidden />
                          Download timetable
                        </Link>
                      </DropdownMenuItem>
                    </RequirePermissions>
                    {editable && (
                      <RequirePermissions
                        permissions={schoolPermission(
                          scope.schoolId,
                          SCHOOL_ACTIONS.DELETE_EXAM_TIMETABLE,
                        )}
                      >
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => {
                            form.setErrorMap({});
                            form.setFieldValue('confirmingDelete', true);
                          }}
                        >
                          <Trash2 aria-hidden />
                          Delete timetable
                        </DropdownMenuItem>
                      </RequirePermissions>
                    )}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <ConfirmationDialog
                open={values.confirmingDelete}
                title="Delete timetable"
                description={`Delete the entire ${context.exam.name} timetable, including every class and slot?`}
                confirmLabel={pending ? 'Deleting…' : 'Delete timetable'}
                pending={pending}
                onOpenChange={(open) =>
                  form.setFieldValue('confirmingDelete', open)
                }
                onConfirm={() => {
                  if (!pending) void form.handleSubmit();
                }}
              >
                <Issues errors={errors} />
              </ConfirmationDialog>
            </>
          )}
        </>
      )}
    </form.Subscribe>
  );
}

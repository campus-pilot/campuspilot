'use client';
import { toast } from '@campuspilot/ui/lib/toast';
import { SlotEditor } from '@campuspilot/components/exam/timetable-slot-editor';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  saveExamTimetableInputSchema,
  type ExamContextDto,
} from '@campuspilot/api/routers/school/exam/exam.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { client, orpc } from '@/lib/orpc';
import {
  DirtyGuard,
  ExamButton,
  ExamInput,
  ExamSelect,
  Issues,
  LoadingExam,
  Notice,
  ReadError,
  submitExam,
  useExamCache,
} from './exam-common';
import { errorMessage, schoolPermission, type ExamScope } from './exam-model';
import { ExamCommand } from './exam-command';
import { timetableFormSchema, timetableSchema } from './exam-validation';

type Config = z.infer<typeof saveExamTimetableInputSchema>['config'];
type Row = Config['rows'][number];
type Pair = { subjectSlug: string; modeSlug: string };
const asPairs = (cell: Row['cells'][string]): Pair[] =>
  cell == null ? [] : Array.isArray(cell) ? cell : [cell];

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
  const view = useForm({
    defaultValues: { classId: context.classes[0]?.id ?? '' },
    validators: { onChange: z.object({ classId: z.string() }) },
  });
  if (query.isPending) return <LoadingExam />;
  if (query.isError && query.data === undefined)
    return <ReadError error={query.error} retry={query.refetch} />;
  return (
    <div className="flex flex-col gap-4">
      {query.isError && <ReadError error={query.error} retry={query.refetch} />}
      <Notice>
        One shared timetable for the entire exam. Timetable columns do not
        create assessment plans.
      </Notice>
      <view.Subscribe selector={(state) => state.values.classId}>
        {(classId) => (
          <>
            <ExamSelect
              label="View class"
              value={classId}
              onChange={(value) => view.setFieldValue('classId', value)}
            >
              {context.classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </ExamSelect>
            {query.data === null ? (
              <Notice>No timetable yet</Notice>
            ) : !query.data!.config.rows.length ? (
              <Notice>No exam slots added</Notice>
            ) : (
              <TimetableSlots
                config={query.data!.config}
                context={context}
                classId={classId}
              />
            )}
          </>
        )}
      </view.Subscribe>
      {
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
      }
    </div>
  );
}
function TimetableSlots({
  config,
  context,
  classId,
}: {
  config: Config;
  context: ExamContextDto;
  classId: string;
}) {
  const rows = [...config.rows].sort((a, b) =>
    `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`),
  );
  const subjects =
    context.classes.find((item) => item.id === classId)?.subjects ?? {};
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <article
          key={row.id}
          className="flex flex-col gap-2 rounded-xl border p-4"
        >
          <h3 className="font-semibold">
            {row.date} · {row.startTime}–{row.endTime}
          </h3>
          {asPairs(row.cells[classId] ?? null).length ? (
            asPairs(row.cells[classId] ?? null).map((pair) => (
              <p
                key={`${pair.subjectSlug}:${pair.modeSlug}`}
                className="break-words text-sm"
              >
                {subjects[pair.subjectSlug]?.name ?? pair.subjectSlug} ·{' '}
                {subjects[pair.subjectSlug]?.examModes[pair.modeSlug]?.name ??
                  pair.modeSlug}
              </p>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No assessment for this class
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
function TimetableActions({
  scope,
  context,
  active,
}: {
  scope: ExamScope;
  context: ExamContextDto;
  active: boolean;
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
    },
    validators: {
      onChange: z.object({
        editing: z.boolean(),
        baseline: saveExamTimetableInputSchema.shape.config.nullable(),
        version: z.string(),
        editorKey: z.number(),
        error: z.string(),
      }),
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
      return;
    }
    form.setFieldValue(
      'baseline',
      result.data?.config ?? { columns: [], rows: [] },
    );
    form.setFieldValue('version', result.data?.updatedAt?.toISOString() ?? '');
    form.setFieldValue('editorKey', form.getFieldValue('editorKey') + 1);
    form.setFieldValue('editing', true);
  };
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <>
          {completed.isError && (
            <ReadError error={completed.error} retry={completed.refetch} />
          )}
          {!editable && (
            <Notice>
              {completed.data?.pagination.totalItems
                ? 'The shared timetable is locked because an assessment plan is completed. Reopen completed plans before editing.'
                : 'Timetable is read-only while session or plan status is unavailable/inactive.'}
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
            ) : editable ? (
              <ExamButton
                onClick={() => {
                  void open();
                }}
              >
                {timetable.data ? 'Edit shared timetable' : 'Create timetable'}
              </ExamButton>
            ) : null}
          </RequirePermissions>
          {values.error && <Notice error>{values.error}</Notice>}
          {editable && timetable.data && !values.editing && (
            <ExamCommand
              permissions={schoolPermission(
                scope.schoolId,
                SCHOOL_ACTIONS.DELETE_EXAM_TIMETABLE,
              )}
              label="Delete shared timetable"
              destructive
              explanation={`Delete the entire ${context.exam.name} timetable, including every class and slot?`}
              run={async () => {
                await client.school.deleteExamTimetable(scope);
                queries.cache.setQueryData(
                  orpc.school.getExamTimetable.queryKey({ input: scope }),
                  null,
                );
              }}
              onFailure={async () => {
                await timetable.refetch();
              }}
            />
          )}
        </>
      )}
    </form.Subscribe>
  );
}

function useTimetableEditor({
  scope,
  context,
  initial,
  editable,
  newer,
  onReload,
  onClose,
}: {
  scope: ExamScope;
  context: ExamContextDto;
  initial: Config;
  editable: boolean;
  newer: boolean;
  onReload: () => Promise<void>;
  onClose: () => void;
}) {
  const queries = useExamCache();
  const configSchema = timetableSchema(context);
  const form = useForm({
    defaultValues: {
      config: initial,
      classId: initial.columns[0] ?? '',
      addClassId:
        context.classes.find((item) => !initial.columns.includes(item.id))
          ?.id ?? '',
      message: '',
    },
    validators: { onSubmit: timetableFormSchema(context) },
    onSubmit: async ({ value }) => {
      if (!editable) {
        form.setErrorMap({
          onSubmit: { form: 'Timetable editing is closed.', fields: {} },
        });
        return;
      }
      try {
        const config = configSchema.parse(value.config);
        const saved = await client.school.saveExamTimetable({
          ...scope,
          config,
        });
        queries.cache.setQueryData(
          orpc.school.getExamTimetable.queryKey({ input: scope }),
          saved,
        );
        form.reset({
          ...value,
          config: saved.config,
          message: 'Shared timetable saved.',
        });
        toast.success('Shared timetable saved.');
        onClose();
      } catch (error) {
        form.setErrorMap({
          onSubmit: { form: errorMessage(error), fields: {} },
        });
        await Promise.all([
          queries.cache.invalidateQueries({
            queryKey: orpc.school.getExamTimetable.key({ input: scope }),
          }),
          queries.plans(scope),
        ]);
      }
    },
  });
  /** Every edit replaces only its target in the full form-owned grid; hidden classes and stable row IDs survive. */
  const updateRows = (rows: Row[]) =>
    form.setFieldValue('config', { ...form.getFieldValue('config'), rows });
  const updateColumns = (columns: string[]) =>
    form.setFieldValue('config', { ...form.getFieldValue('config'), columns });
  const patchRow = (id: string, patch: Partial<Row>) =>
    updateRows(
      form
        .getFieldValue('config')
        .rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  return { form, configSchema, patchRow, updateRows, updateColumns };
}

function TimetableEditor({
  scope,
  context,
  initial,
  editable,
  newer,
  onReload,
  onClose,
}: {
  scope: ExamScope;
  context: ExamContextDto;
  initial: Config;
  editable: boolean;
  newer: boolean;
  onReload: () => Promise<void>;
  onClose: () => void;
}) {
  const { form, configSchema, patchRow, updateRows, updateColumns } =
    useTimetableEditor({
      scope,
      context,
      initial,
      editable,
      newer,
      onReload,
      onClose,
    });
  return (
    <form
      className="flex flex-col gap-4 rounded-xl border p-4 pb-24"
      onSubmit={(event) => submitExam(event, form.handleSubmit)}
    >
      <h2 className="text-lg font-semibold">Edit shared timetable</h2>
      <form.Field name="config">
        {() => (
          <form.Subscribe
            selector={(state) => ({
              ...state.values,
              dirty:
                state.isDirty &&
                JSON.stringify(state.values.config) !==
                  JSON.stringify(form.options.defaultValues?.config),
              submitting: state.isSubmitting,
              canSubmit: state.canSubmit,
              errors: state.errors,
              attempts: state.submissionAttempts,
            })}
          >
            {({
              config,
              classId,
              addClassId,
              dirty,
              submitting,
              canSubmit,
              errors,
              attempts,
            }) => {
              // Validate once per render, then attach relevant issues to each shared slot.
              const validationIssues =
                attempts > 0
                  ? (configSchema.safeParse(config).error?.issues ?? [])
                  : [];
              return (
                <>
                  <DirtyGuard dirty={dirty} />
                  {newer && (
                    <Notice>
                      The server timetable changed while this editor was open.
                      Review your edits or reload deliberately. Saving replaces
                      the full grid.
                      <ExamButton
                        type="button"
                        variant="outline"
                        onClick={() => {
                          if (
                            !dirty ||
                            window.confirm(
                              'Discard your timetable edits and reload the saved grid?',
                            )
                          )
                            void onReload();
                        }}
                      >
                        Reload saved timetable
                      </ExamButton>
                    </Notice>
                  )}
                  <ExamSelect
                    label="Edit class"
                    value={classId}
                    onChange={(value) => form.setFieldValue('classId', value)}
                  >
                    <option value="">Choose a class column</option>
                    {config.columns.map((id) => (
                      <option key={id} value={id}>
                        {context.classes.find((item) => item.id === id)
                          ?.label ?? id}
                      </option>
                    ))}
                  </ExamSelect>
                  <div className="flex flex-col gap-3">
                    <ExamSelect
                      label="Add class column"
                      disabled={!editable}
                      value={addClassId}
                      onChange={(value) =>
                        form.setFieldValue('addClassId', value)
                      }
                    >
                      <option value="">Choose a class</option>
                      {context.classes
                        .filter((item) => !config.columns.includes(item.id))
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                    </ExamSelect>
                    <ExamButton
                      type="button"
                      variant="outline"
                      disabled={
                        !editable ||
                        !addClassId ||
                        config.columns.includes(addClassId) ||
                        config.columns.length >= 200
                      }
                      onClick={() => {
                        updateColumns([...config.columns, addClassId]);
                        form.setFieldValue('classId', addClassId);
                        form.setFieldValue('addClassId', '');
                      }}
                    >
                      Add column
                    </ExamButton>
                  </div>
                  {classId && (
                    <div className="flex flex-wrap gap-3">
                      <ExamButton
                        type="button"
                        variant="outline"
                        disabled={
                          !editable || config.columns.indexOf(classId) <= 0
                        }
                        onClick={() => {
                          const columns = [...config.columns];
                          const index = columns.indexOf(classId);
                          [columns[index - 1], columns[index]] = [
                            columns[index]!,
                            columns[index - 1]!,
                          ];
                          updateColumns(columns);
                        }}
                      >
                        Move column earlier
                      </ExamButton>
                      <ExamButton
                        type="button"
                        variant="destructive"
                        disabled={!editable}
                        onClick={() => {
                          if (
                            !window.confirm(
                              'Remove this class column and all its timetable assignments?',
                            )
                          )
                            return;
                          form.setFieldValue('config', {
                            columns: config.columns.filter(
                              (id) => id !== classId,
                            ),
                            rows: config.rows.map((row) => ({
                              ...row,
                              cells: Object.fromEntries(
                                Object.entries(row.cells).filter(
                                  ([id]) => id !== classId,
                                ),
                              ),
                            })),
                          });
                          form.setFieldValue('classId', '');
                        }}
                      >
                        Remove column
                      </ExamButton>
                    </div>
                  )}
                  <Notice>
                    Slot dates and times are shared across classes. Editing a
                    time changes the slot for every class. Slots below retain
                    their saved order.
                  </Notice>
                  {config.rows.map((row, index) => (
                    <SlotEditor
                      key={row.id}
                      row={row}
                      disabled={!editable}
                      classId={classId}
                      context={context}
                      errors={validationIssues.filter(
                        (issue) =>
                          issue.path[0] === 'rows' && issue.path[1] === index,
                      )}
                      onPatch={(patch) => patchRow(row.id, patch)}
                      onRemove={() => {
                        if (
                          window.confirm(
                            'Delete this shared slot for every class?',
                          )
                        )
                          updateRows(
                            config.rows.filter((item) => item.id !== row.id),
                          );
                      }}
                      onMove={
                        index > 0
                          ? () => {
                              const rows = [...config.rows];
                              [rows[index - 1], rows[index]] = [
                                rows[index]!,
                                rows[index - 1]!,
                              ];
                              updateRows(rows);
                            }
                          : undefined
                      }
                    />
                  ))}
                  <ExamButton
                    type="button"
                    variant="outline"
                    disabled={!editable || config.rows.length >= 500}
                    onClick={() =>
                      updateRows([
                        ...config.rows,
                        {
                          id: crypto.randomUUID(),
                          date: '',
                          startTime: '',
                          endTime: '',
                          cells: Object.fromEntries(
                            config.columns.map((id) => [id, null]),
                          ),
                        },
                      ])
                    }
                  >
                    Add shared slot
                  </ExamButton>
                  <Issues errors={errors} />
                  {attempts > 0 && <Issues errors={validationIssues} />}
                  <div className="sticky bottom-0 flex flex-wrap gap-3 border-t bg-background py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    <ExamButton
                      type="submit"
                      disabled={!editable || submitting || !canSubmit}
                    >
                      {submitting ? 'Saving…' : 'Save timetable'}
                    </ExamButton>
                    <ExamButton
                      type="button"
                      variant="outline"
                      disabled={submitting}
                      onClick={() => {
                        if (
                          !dirty ||
                          window.confirm('Discard unsaved timetable changes?')
                        )
                          onClose();
                      }}
                    >
                      Cancel
                    </ExamButton>
                  </div>
                </>
              );
            }}
          </form.Subscribe>
        )}
      </form.Field>
    </form>
  );
}

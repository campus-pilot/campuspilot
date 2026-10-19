'use client';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Maximize2, Minimize2 } from 'lucide-react';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { TimetableBuilder } from '@campuspilot/components/exam/timetable-builder';
import { toast } from '@campuspilot/ui/lib/toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import {
  saveExamTimetableInputSchema,
  type ExamContextDto,
} from '@campuspilot/api/routers/school/exam/exam.dto';
import { client, orpc } from '@/lib/orpc';
import {
  DirtyGuard,
  ExamButton,
  Issues,
  Notice,
  submitExam,
  useExamCache,
} from './exam-common';
import {
  errorMessage,
  isExamSaveUncertain,
  type ExamScope,
} from './exam-model';
import { timetableFormSchema, timetableSchema } from './exam-validation';

type Config = z.infer<typeof saveExamTimetableInputSchema>['config'];

function useTimetableEditor({
  scope,
  context,
  initial,
  editable,
  onClose,
}: {
  scope: ExamScope;
  context: ExamContextDto;
  initial: Config;
  editable: boolean;
  onClose: () => void;
}) {
  const queries = useExamCache();
  const configSchema = timetableSchema(context);
  const form = useForm({
    defaultValues: {
      config: initial,
      classId: initial.columns[0] ?? '',
      expanded: false,
      uncertain: false,
      confirmation: '' as '' | 'discard' | 'reload',
    },
    validators: {
      onSubmit: timetableFormSchema(context).extend({
        expanded: z.boolean(),
        uncertain: z.boolean(),
        confirmation: z.enum(['', 'discard', 'reload']),
      }),
    },
    onSubmit: async ({ value }) => {
      if (value.uncertain) return;
      if (!editable) {
        form.setErrorMap({
          onSubmit: { form: 'Timetable editing is closed.', fields: {} },
        });
        return;
      }
      try {
        const saved = await client.school.saveExamTimetable({
          ...scope,
          config: configSchema.parse(value.config),
        });
        queries.cache.setQueryData(
          orpc.school.getExamTimetable.queryKey({ input: scope }),
          saved,
        );
        form.reset({
          ...value,
          config: saved.config,
        });
        toast.success('Timetable saved.');
        onClose();
      } catch (error) {
        if (isExamSaveUncertain(error)) form.setFieldValue('uncertain', true);
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
  return { form, configSchema };
}

/** The editor mounts only after an explicit open/refetch. Fullscreen is form-owned
 * presentation state; neither resizing nor changing the mobile class resets data.
 */
export function TimetableEditor({
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
  const { form, configSchema } = useTimetableEditor({
    scope,
    context,
    initial,
    editable,
    onClose,
  });
  return (
    <form.Subscribe
      selector={(state) => ({
        ...state.values,
        dirty:
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
        expanded,
        uncertain,
        confirmation,
        dirty,
        submitting,
        canSubmit,
        errors,
        attempts,
      }) => {
        const issues =
          attempts > 0
            ? (configSchema.safeParse(config).error?.issues ?? [])
            : [];
        const close = () => {
          if (submitting) return;
          if (dirty) form.setFieldValue('confirmation', 'discard');
          else onClose();
        };
        return (
          <>
            <ConfirmationDialog
              open={confirmation !== ''}
              title="Discard unsaved timetable changes?"
              description={
                confirmation === 'reload'
                  ? 'Your edits will be replaced with the saved timetable.'
                  : 'Your edits will be lost. The saved timetable will stay as it was.'
              }
              confirmLabel={
                confirmation === 'reload'
                  ? 'Discard and reload'
                  : 'Discard changes'
              }
              cancelLabel="Keep editing"
              onOpenChange={(open) => {
                if (!open) form.setFieldValue('confirmation', '');
              }}
              onConfirm={() => {
                form.setFieldValue('confirmation', '');
                if (confirmation === 'reload') void onReload();
                else onClose();
              }}
            />
            <Dialog
              open
              onOpenChange={(open) => {
                if (!open) close();
              }}
            >
              <DialogContent
                aria-describedby={undefined}
                showCloseButton={!submitting}
                className={`flex min-w-0 flex-col overflow-hidden ${expanded ? 'h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] sm:max-w-[calc(100vw-1rem)]' : 'max-h-[92dvh] w-[calc(100vw-1rem)] sm:max-w-6xl'}`}
              >
                <DialogHeader>
                  <DialogTitle>Timetable · {context.exam.name}</DialogTitle>
                </DialogHeader>
                <form
                  className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden"
                  onSubmit={(event) =>
                    submitExam(event, async () => {
                      await form.handleSubmit();
                      const failure = configSchema.safeParse(
                        form.getFieldValue('config'),
                      );
                      const hiddenClass = failure.error?.issues.find(
                        (issue) =>
                          issue.path[2] === 'cells' &&
                          typeof issue.path[3] === 'string',
                      )?.path[3];
                      // Reveal the invalid class before the shared focus helper runs;
                      // a mobile user must be able to correct hidden-column errors.
                      if (typeof hiddenClass === 'string')
                        form.setFieldValue('classId', hiddenClass);
                    })
                  }
                >
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-auto">
                    <DirtyGuard dirty={dirty} />
                    {(newer || uncertain) && (
                      <Notice>
                        {uncertain
                          ? 'The save could not be confirmed. Reload the saved timetable before trying again.'
                          : 'The server timetable changed. Saving replaces the full grid. Review your edits or reload deliberately.'}
                        <ExamButton
                          type="button"
                          variant="outline"
                          disabled={submitting}
                          onClick={() => {
                            if (dirty)
                              form.setFieldValue('confirmation', 'reload');
                            else void onReload();
                          }}
                        >
                          Reload saved timetable
                        </ExamButton>
                      </Notice>
                    )}
                    <form.Field name="config">
                      {() => (
                        <TimetableBuilder
                          config={config}
                          classes={context.classes}
                          selectedClassId={classId}
                          disabled={!editable || submitting}
                          issues={issues}
                          onChange={(next) =>
                            form.setFieldValue('config', next)
                          }
                          onSelectClass={(id) =>
                            form.setFieldValue('classId', id)
                          }
                        />
                      )}
                    </form.Field>
                    <Issues errors={issues.length ? [] : errors} />
                    {issues.length > 0 && (
                      <Notice error>
                        Review the highlighted timetable fields before saving.
                        Every class column is checked, including those not
                        currently visible.
                      </Notice>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-3 border-t bg-background py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    <ExamButton
                      type="button"
                      variant="outline"
                      aria-label={
                        expanded
                          ? 'Exit expanded timetable'
                          : 'Expand timetable'
                      }
                      onClick={() => form.setFieldValue('expanded', !expanded)}
                    >
                      {expanded ? (
                        <Minimize2 aria-hidden />
                      ) : (
                        <Maximize2 aria-hidden />
                      )}
                      {expanded ? 'Compact view' : 'Expand editor'}
                    </ExamButton>
                    <ExamButton
                      type="submit"
                      className="ml-auto"
                      disabled={
                        !editable || submitting || !canSubmit || uncertain
                      }
                    >
                      {submitting ? 'Saving…' : 'Save'}
                    </ExamButton>
                    <ExamButton
                      type="button"
                      variant="outline"
                      disabled={submitting}
                      onClick={close}
                    >
                      Cancel
                    </ExamButton>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </>
        );
      }}
    </form.Subscribe>
  );
}

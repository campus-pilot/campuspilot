'use client';
import { toast } from '@campuspilot/ui/lib/toast';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { planFormSchema } from './exam-validation';
import type {
  ExamContextDto,
  ExamPlanDto,
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
  Notice,
  submitExam,
  useExamCache,
} from './exam-common';
import {
  errorCode,
  errorMessage,
  nullableNumber,
  planHref,
  schoolPermission,
  type ExamScope,
} from './exam-model';

function configuredModes(
  context: ExamContextDto,
  classId: string,
  subjectSlug: string,
) {
  return Object.entries(
    context.classes.find((item) => item.id === classId)?.subjects[subjectSlug]
      ?.examModes ?? {},
  ).map(([slug, mode]) => ({
    slug,
    percentage: String(mode.percentage),
    enabled: true,
  }));
}
function useExamPlanForm({
  scope,
  context,
  plan,
  onClose,
  active,
}: {
  scope: ExamScope;
  context: ExamContextDto;
  plan?: ExamPlanDto;
  onClose: () => void;
  active: boolean;
}) {
  const queries = useExamCache();
  const schema = planFormSchema(context);
  const configured = plan
    ? configuredModes(context, plan.classId, plan.subjectSlug)
    : [];
  const initialModes = plan
    ? [
        ...new Set([
          ...Object.keys(plan.modeConfig),
          ...configured.map((mode) => mode.slug),
        ]),
      ].map((slug) => ({
        slug,
        percentage: String(
          plan.modeConfig[slug]?.percentage ??
            configured.find((mode) => mode.slug === slug)?.percentage ??
            0,
        ),
        enabled: !!plan.modeConfig[slug],
      }))
    : [];
  const form = useForm({
    defaultValues: {
      classId: plan?.classId ?? '',
      subjectSlug: plan?.subjectSlug ?? '',
      totalMarks: String(plan?.totalMarks ?? 100),
      totalWorkingDays:
        plan?.totalWorkingDays == null ? '' : String(plan.totalWorkingDays),
      modes: initialModes,
      duplicate: false,
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      if (!active || (plan && !['draft', 'approved'].includes(plan.status))) {
        form.setErrorMap({
          onSubmit: {
            form: 'Plan configuration is now read-only.',
            fields: {},
          },
        });
        return;
      }
      try {
        const valid = schema.parse(value);
        const values = {
          totalMarks: Number(valid.totalMarks),
          totalWorkingDays: nullableNumber(valid.totalWorkingDays),
          modeConfig: Object.fromEntries(
            valid.modes
              .filter((mode) => mode.enabled)
              .map((mode) => [
                mode.slug,
                {
                  percentage: Number(mode.percentage),
                  maxMarks:
                    (Number(valid.totalMarks) * Number(mode.percentage)) / 100,
                },
              ]),
          ),
        };
        const saved = plan
          ? await client.school.updateExamPlan({
              schoolId: scope.schoolId,
              sessionId: scope.sessionId,
              classId: plan.classId,
              examPlanId: plan.id,
              ...values,
            })
          : await client.school.createExamPlan({
              ...scope,
              classId: valid.classId,
              subjectSlug: valid.subjectSlug,
              ...values,
            });
        queries.cache.setQueryData(
          orpc.school.getExamPlan.queryKey({
            input: {
              schoolId: scope.schoolId,
              sessionId: scope.sessionId,
              classId: saved.classId,
              examPlanId: saved.id,
            },
          }),
          saved,
        );
        form.reset({
          classId: saved.classId,
          subjectSlug: saved.subjectSlug,
          totalMarks: String(saved.totalMarks),
          totalWorkingDays:
            saved.totalWorkingDays === null
              ? ''
              : String(saved.totalWorkingDays),
          modes: Object.entries(saved.modeConfig).map(([slug, mode]) => ({
            slug,
            percentage: String(mode.percentage),
            enabled: true,
          })),
          duplicate: false,
        });
        await queries.plans(scope);
        toast.success('Assessment plan saved as Draft.');
        onClose();
      } catch (error) {
        form.setErrorMap({
          onSubmit: { form: errorMessage(error), fields: {} },
        });
        form.setFieldValue('duplicate', errorCode(error) === 'CONFLICT');
        await queries.plans(scope);
      }
    },
  });
  /** Parent changes deliberately replace dependent modes; the current customization is never silently remapped. */
  const choose = (classId: string, subjectSlug: string) => {
    const defaults = configuredModes(
      context,
      form.getFieldValue('classId'),
      form.getFieldValue('subjectSlug'),
    );
    const modes = form.getFieldValue('modes');
    const customized =
      modes.length !== defaults.length ||
      modes.some(
        (mode) =>
          !mode.enabled ||
          Number(mode.percentage) !==
            Number(
              defaults.find((item) => item.slug === mode.slug)?.percentage,
            ),
      );
    if (
      customized &&
      modes.length > 0 &&
      !window.confirm(
        'Changing class or subject replaces your customized assessment components. Continue?',
      )
    )
      return;
    form.setFieldValue('classId', classId);
    form.setFieldValue('subjectSlug', subjectSlug);
    form.setFieldValue('modes', configuredModes(context, classId, subjectSlug));
  };
  return { form, choose };
}

export function ExamPlanForm({
  scope,
  context,
  plan,
  onClose,
  active,
}: {
  scope: ExamScope;
  context: ExamContextDto;
  plan?: ExamPlanDto;
  onClose: () => void;
  active: boolean;
}) {
  const { form, choose } = useExamPlanForm({
    scope,
    context,
    plan,
    onClose,
    active,
  });
  return (
    <section className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-lg font-semibold">
        {plan ? 'Edit assessment plan' : 'Create assessment plan'}
      </h2>
      {!active && (
        <Notice>
          Plan configuration is now read-only. Your unsaved values remain
          available for review.
        </Notice>
      )}
      {plan?.status === 'approved' && (
        <Notice>
          Saving an edit returns this approved plan to Draft. Review and approve
          it again before opening entry.
        </Notice>
      )}
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => submitExam(event, form.handleSubmit)}
      >
        <form.Field name="classId">
          {(field) => (
            <>
              <ExamSelect
                label="Class"
                name={field.name}
                errors={field.state.meta.errors}
                value={field.state.value}
                disabled={!active || !!plan}
                onChange={(value) => choose(value, '')}
              >
                <option value="">Choose a class</option>
                {context.classes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </ExamSelect>
              <Issues errors={field.state.meta.errors} />
            </>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.classId}>
          {(classId) => (
            <form.Field name="subjectSlug">
              {(field) => (
                <>
                  <ExamSelect
                    label="Subject"
                    name={field.name}
                    errors={field.state.meta.errors}
                    value={field.state.value}
                    disabled={!active || !!plan || !classId}
                    onChange={(value) => choose(classId, value)}
                  >
                    <option value="">Choose a subject</option>
                    {Object.entries(
                      context.classes.find((item) => item.id === classId)
                        ?.subjects ?? {},
                    ).map(([slug, subject]) => (
                      <option key={slug} value={slug}>
                        {subject.name}
                      </option>
                    ))}
                    {plan &&
                      !context.classes.find((item) => item.id === classId)
                        ?.subjects[plan.subjectSlug] && (
                        <option value={plan.subjectSlug}>
                          {plan.subjectSlug} (removed configuration)
                        </option>
                      )}
                  </ExamSelect>
                  <Issues errors={field.state.meta.errors} />
                </>
              )}
            </form.Field>
          )}
        </form.Subscribe>
        <form.Field name="totalMarks">
          {(field) => (
            <ExamInput field={field} label="Total marks" inputMode="numeric" />
          )}
        </form.Field>
        <PlanComponents form={form} context={context} active={active} />
        {(context.attendanceTracking.enabled ||
          plan?.totalWorkingDays != null) && (
          <form.Field name="totalWorkingDays">
            {(field) => (
              <ExamInput
                field={field}
                label="Total working days (optional)"
                disabled={!active}
                inputMode="numeric"
              />
            )}
          </form.Field>
        )}
        <form.Subscribe
          selector={(state) => ({
            dirty: state.isDirty,
            submitting: state.isSubmitting,
            errors: state.errors,
            canSubmit: state.canSubmit,
            values: state.values,
          })}
        >
          {({ dirty, submitting, errors, canSubmit, values }) => (
            <>
              <DirtyGuard dirty={dirty} />
              <Issues errors={errors} />
              {values.duplicate && (
                <RequirePermissions
                  permissions={schoolPermission(
                    scope.schoolId,
                    SCHOOL_ACTIONS.READ_EXAM_PLANS,
                  )}
                >
                  <ExistingPlan
                    scope={scope}
                    classId={values.classId}
                    subjectSlug={values.subjectSlug}
                  />
                </RequirePermissions>
              )}
              <div className="flex flex-wrap gap-3">
                <ExamButton
                  type="submit"
                  disabled={!active || !canSubmit || submitting}
                >
                  {submitting ? 'Saving…' : 'Save plan'}
                </ExamButton>
                <ExamButton
                  type="button"
                  variant="outline"
                  disabled={submitting}
                  onClick={() => {
                    if (
                      !dirty ||
                      window.confirm('Discard unsaved plan changes?')
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
function ExistingPlan({
  scope,
  classId,
  subjectSlug,
}: {
  scope: ExamScope;
  classId: string;
  subjectSlug: string;
}) {
  const query = useQuery({
    queryKey: [
      ...orpc.school.listExamPlans.key({
        input: { ...scope, filters: { classId } },
      }),
      'duplicate',
      subjectSlug,
    ],
    queryFn: async () => {
      let page = 1;
      for (;;) {
        const response = await client.school.listExamPlans({
          ...scope,
          filters: { classId },
          page,
          limit: 20,
        });
        const plan = response.items.find(
          (item) => item.subjectSlug === subjectSlug,
        );
        if (plan || page >= response.pagination.totalPages) return plan ?? null;
        page++;
      }
    },
  });
  return query.data ? (
    <Link
      className="flex min-h-11 items-center underline"
      href={planHref({ ...scope, classId, examPlanId: query.data.id })}
    >
      Open existing class/subject plan
    </Link>
  ) : (
    <Notice>
      A plan for this class and subject already exists. Review the plans list.
    </Notice>
  );
}

function PlanComponents({
  form,
  context,
  active,
}: {
  form: ReturnType<typeof useExamPlanForm>['form'];
  context: ExamContextDto;
  active: boolean;
}) {
  return (
    <form.Subscribe
      selector={(state) => ({
        total: state.values.totalMarks,
        classId: state.values.classId,
        subject: state.values.subjectSlug,
      })}
    >
      {({ total, classId, subject }) => (
        <form.Field name="modes" mode="array">
          {(field) => (
            <div className="flex flex-col gap-3">
              <h3 className="font-medium">Assessment components</h3>
              {field.state.value.length === 0 && (
                <Notice>
                  Choose a subject with configured assessment components. Class
                  settings must be configured before a plan can be created.
                </Notice>
              )}
              {field.state.value
                .filter((mode) => mode.enabled)
                .map((mode) => (
                  <p key={mode.slug} className="text-sm">
                    {context.classes.find((item) => item.id === classId)
                      ?.subjects[subject]?.examModes[mode.slug]?.name ??
                      mode.slug}{' '}
                    · {mode.percentage}% · Maximum{' '}
                    {(Number(total) * Number(mode.percentage)) / 100}
                  </p>
                ))}
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">
                  Customize components and percentages
                </summary>
                <div className="flex flex-col gap-3">
                  {field.state.value.map((mode, index) => (
                    <PlanModeOption
                      key={mode.slug}
                      form={form}
                      mode={mode}
                      index={index}
                      active={active}
                      label={
                        context.classes.find((item) => item.id === classId)
                          ?.subjects[subject]?.examModes[mode.slug]?.name ??
                        mode.slug
                      }
                    />
                  ))}
                </div>
              </details>
              <Issues errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
      )}
    </form.Subscribe>
  );
}

function PlanModeOption({
  form,
  mode,
  index,
  active,
  label,
}: {
  form: ReturnType<typeof useExamPlanForm>['form'];
  mode: { slug: string; percentage: string; enabled: boolean };
  index: number;
  active: boolean;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <form.Field name={`modes[${index}].enabled`}>
        {(enabled) => (
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              disabled={!active}
              checked={enabled.state.value}
              onChange={(event) => enabled.handleChange(event.target.checked)}
            />
            {label}
          </label>
        )}
      </form.Field>
      <form.Field name={`modes[${index}].percentage`}>
        {(percent) => (
          <ExamInput
            field={percent}
            label="Percentage"
            inputMode="decimal"
            disabled={!active || !mode.enabled}
          />
        )}
      </form.Field>
    </div>
  );
}

'use client';
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Play,
  Settings2,
  CheckCircle2,
  RotateCcw,
  Send,
  Undo2,
} from 'lucide-react';
import { AppShellAlert } from '@campuspilot/components/app-shell';
import type { ExamOverviewDto } from '@campuspilot/api/routers/school/exam/exam.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@campuspilot/ui/components/dialog';
import { RequirePermissions } from '@/components/require-permissions';
import { client, orpc } from '@/lib/orpc';
import { ExamButton, ExamInput, Issues } from './exam-common';
import {
  cadetReleaseAction,
  examActionDescription,
  examActionLabel,
  errorMessage,
  reopenBlockedReason,
  optionalIntegerText,
  schoolPermission,
  type ExamScope,
} from './exam-model';

type Action = '' | 'working-days' | 'start' | 'complete' | 'reopen' | 'release' | 'withdraw';
type LifecycleAction = Exclude<Action, '' | 'working-days' | 'release' | 'withdraw'>;
type CadetAction = Extract<Action, 'release' | 'withdraw'>;
type Props = {
  scope: ExamScope;
  active: boolean;
  overview: ExamOverviewDto;
  attendanceEnabled: boolean;
  totalWorkingDays: number | null;
  placement?: 'workspace' | 'navbar' | 'settings';
};
export function ExamActions(props: Props) {
  const { scope, active, overview, attendanceEnabled, totalWorkingDays, placement = 'workspace' } = props;
  const ui = useForm({
    defaultValues: { action: '' as Action },
    validators: {
      onChange: z.object({
        action: z.enum(['', 'working-days', 'start', 'complete', 'reopen', 'release', 'withdraw']),
      }),
    },
  });
  const canConfigure =
    active && overview.planCount > 0 && overview.status !== 'completed';
  const lifecycleAction =
    overview.status === 'active'
      ? 'complete'
      : overview.status === 'completed'
        ? 'reopen'
        : 'start';
  const applicableCadetAction = cadetReleaseAction(overview);
  const cadetAction: CadetAction = applicableCadetAction ?? 'release';
  const cadetVisible = applicableCadetAction !== null;
  return (
    <>
      {placement === 'workspace' && attendanceEnabled &&
        totalWorkingDays === null &&
        overview.planCount > 0 &&
        overview.status !== 'completed' && (
          <RequirePermissions
            permissions={schoolPermission(
              scope.schoolId,
              SCHOOL_ACTIONS.UPDATE_EXAM_PLAN,
            )}
            fallback={<WorkingDaysAlert scope={scope} />}
          >
            <WorkingDaysAlert
              scope={scope}
              onConfigure={
                canConfigure
                  ? () => ui.setFieldValue('action', 'working-days')
                  : undefined
              }
            />
          </RequirePermissions>
        )}
      {placement === 'settings' && (
        <div className="flex flex-col gap-4">
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">Attendance working days</h3>
              <p className="text-sm text-muted-foreground">
                {attendanceEnabled
                  ? totalWorkingDays === null ? 'Not configured' : `${totalWorkingDays} working days`
                  : 'Attendance tracking is disabled in session settings.'}
              </p>
            </div>
            {attendanceEnabled && canConfigure && (
              <RequirePermissions permissions={schoolPermission(scope.schoolId, SCHOOL_ACTIONS.UPDATE_EXAM_PLAN)}>
                <ExamButton variant="outline" onClick={() => ui.setFieldValue('action', 'working-days')}>
                  <Settings2 aria-hidden />Edit working days
                </ExamButton>
              </RequirePermissions>
            )}
          </section>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">Examination lifecycle</h3>
              <p className="text-sm text-muted-foreground">Control when results can be entered and finalized.</p>
            </div>
            <LifecycleTrigger scope={scope} visible={active && overview.planCount > 0}
              action={lifecycleAction} blockedReason={lifecycleAction === 'reopen' ? reopenBlockedReason(overview) : null}
              onSelect={() => ui.setFieldValue('action', lifecycleAction)} />
          </section>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">Cadet Portal</h3>
              <p className="text-sm text-muted-foreground">{cadetStatusText(overview)}</p>
            </div>
            <CadetReleaseTrigger scope={scope} visible={cadetVisible}
              action={cadetAction} onSelect={() => ui.setFieldValue('action', cadetAction)} />
          </section>
        </div>
      )}
      {placement === 'navbar' && (
        <div className="flex flex-wrap items-center gap-2">
          <LifecycleTrigger scope={scope} visible={active && overview.planCount > 0}
            action={lifecycleAction} blockedReason={lifecycleAction === 'reopen' ? reopenBlockedReason(overview) : null}
            onSelect={() => ui.setFieldValue('action', lifecycleAction)} />
          <CadetReleaseTrigger scope={scope} visible={cadetVisible} compact
            action={cadetAction} onSelect={() => ui.setFieldValue('action', cadetAction)} />
        </div>
      )}
      <ui.Subscribe selector={(state) => state.values.action}>
        {(action) =>
          action && (
            <RequirePermissions
              permissions={schoolPermission(
                scope.schoolId,
                action === 'working-days'
                  ? SCHOOL_ACTIONS.UPDATE_EXAM_PLAN
                  : SCHOOL_ACTIONS.TRANSITION_EXAM_PLAN,
              )}
            >
              <ExamActionDialog
                key={action}
                scope={scope}
                action={action}
                initial={totalWorkingDays}
                released={overview.cadetReleasedAt !== null}
                onClose={() => ui.setFieldValue('action', '')}
              />
            </RequirePermissions>
          )
        }
      </ui.Subscribe>
    </>
  );
}
/** Release state in words; the release time is its own fact, shown when known. */
function cadetStatusText(overview: ExamOverviewDto) {
  if (overview.cadetReleasedAt)
    return `Results released to students on ${new Date(overview.cadetReleasedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}.`;
  if (overview.status === 'completed')
    return 'Not released. Students see this examination as awaiting results.';
  return 'Results can be released to students after the examination is completed.';
}

/** `compact` uses the short navbar wording so the button does not wrap on a phone. */
function CadetReleaseTrigger({ scope, visible, action, compact = false, onSelect }: {
  scope: ExamScope; visible: boolean; action: CadetAction; compact?: boolean; onSelect: () => void;
}) {
  if (!visible) return null;
  const Icon = action === 'release' ? Send : Undo2;
  return (
    <RequirePermissions permissions={schoolPermission(scope.schoolId, SCHOOL_ACTIONS.TRANSITION_EXAM_PLAN)}>
      <ExamButton variant="outline" onClick={onSelect}><Icon aria-hidden />{actionLabel(action, compact)}</ExamButton>
    </RequirePermissions>
  );
}

/** A blocked action stays visible but disabled, with its reason next to it, instead of opening a dead-end dialog. */
function LifecycleTrigger({ scope, visible, action, blockedReason = null, onSelect }: {
  scope: ExamScope; visible: boolean; action: LifecycleAction;
  blockedReason?: string | null;
  onSelect: () => void;
}) {
  if (!visible) return null;
  const Icon = action === 'start' ? Play : action === 'complete' ? CheckCircle2 : RotateCcw;
  return (
    <RequirePermissions permissions={schoolPermission(scope.schoolId, SCHOOL_ACTIONS.TRANSITION_EXAM_PLAN)}>
      <span className="flex flex-wrap items-center gap-2">
        {blockedReason && <span className="text-xs text-muted-foreground">{blockedReason}</span>}
        <ExamButton variant="outline" disabled={!!blockedReason} onClick={onSelect}><Icon aria-hidden />{actionLabel(action)}</ExamButton>
      </span>
    </RequirePermissions>
  );
}

function WorkingDaysAlert({
  scope,
  onConfigure,
}: {
  scope: ExamScope;
  onConfigure?: () => void;
}) {
  return (
    <AppShellAlert
      slug={`exam/${scope.schoolId}/${scope.sessionId}/${scope.examSlug}/working-days`}
      type="warning"
      message="Attendance working days are not yet configured for this examination."
      actionLabel={onConfigure ? 'Set working days' : undefined}
      onAction={
        onConfigure
          ? (closeDialog) => {
              closeDialog();
              onConfigure();
            }
          : undefined
      }
    />
  );
}
const actionLabel = examActionLabel;
const actionDescription = examActionDescription;

function ExamActionDialog({
  scope,
  action,
  initial,
  released,
  onClose,
}: {
  scope: ExamScope;
  action: Exclude<Action, ''>;
  initial: number | null;
  /** Reopening is refused while released; the dialog says so and keeps the action disabled. */
  released: boolean;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const workingDays = action === 'working-days';
  const title = workingDays ? 'Attendance working days' : actionLabel(action);
  const form = useForm({
    defaultValues: { days: initial === null ? '' : String(initial) },
    validators: { onSubmit: z.object({ days: optionalIntegerText }) },
    onSubmit: async ({ value }) => {
      try {
        if (workingDays)
          await client.school.updateExamAssessmentSettings({
            ...scope,
            totalWorkingDays: value.days === '' ? null : Number(value.days),
          });
        else if (action === 'release')
          await client.school.releaseExamToCadet(scope);
        else if (action === 'withdraw')
          await client.school.withdrawExamFromCadet(scope);
        else
          await client.school.transitionExam({
            ...scope,
            status: action === 'complete' ? 'completed' : 'active',
          });
        await cache.invalidateQueries({ queryKey: orpc.school.key() });
        onClose();
      } catch (error) {
        form.setErrorMap({
          onSubmit: { form: errorMessage(error), fields: {} },
        });
      }
    },
  });
  return (
    <form.Subscribe
      selector={(state) => ({
        pending: state.isSubmitting,
        canSubmit: state.canSubmit,
        errors: state.errors,
      })}
    >
      {({ pending, canSubmit, errors }) => (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !pending) onClose();
          }}
        >
          <DialogContent showCloseButton={!pending}>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {actionDescription(action, released)}
              </DialogDescription>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void form.handleSubmit();
              }}
            >
              {workingDays && (
                <form.Field name="days">
                  {(field) => (
                    <ExamInput
                      field={field}
                      label="Total working days"
                      inputMode="numeric"
                      disabled={pending}
                    />
                  )}
                </form.Field>
              )}
              <Issues errors={errors} />
              <DialogFooter>
                <ExamButton
                  variant="outline"
                  disabled={pending}
                  onClick={onClose}
                >
                  Cancel
                </ExamButton>
                <ExamButton type="submit" disabled={pending || !canSubmit || (action === 'reopen' && released)}>
                  {pending
                    ? 'Saving…'
                    : workingDays
                      ? 'Save working days'
                      : title}
                </ExamButton>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </form.Subscribe>
  );
}

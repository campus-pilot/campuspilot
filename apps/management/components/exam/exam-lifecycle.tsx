'use client';
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  MoreVertical,
  Play,
  Settings2,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import { AppShellAlert } from '@campuspilot/components/app-shell';
import type { ExamOverviewDto } from '@campuspilot/api/routers/school/exam/exam.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { Button } from '@campuspilot/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
} from '@campuspilot/ui/components/dropdown-menu';
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
  errorMessage,
  optionalIntegerText,
  schoolPermission,
  type ExamScope,
} from './exam-model';

type Action = '' | 'working-days' | 'start' | 'complete' | 'reopen';
type Props = {
  scope: ExamScope;
  active: boolean;
  overview: ExamOverviewDto;
  attendanceEnabled: boolean;
  totalWorkingDays: number | null;
  placement?: 'menu' | 'navbar' | 'settings';
};
export function ExamActions(props: Props) {
  const { scope, active, overview, attendanceEnabled, totalWorkingDays, placement = 'menu' } = props;
  const ui = useForm({
    defaultValues: { action: '' as Action },
    validators: {
      onChange: z.object({
        action: z.enum(['', 'working-days', 'start', 'complete', 'reopen']),
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
  return (
    <>
      {placement === 'menu' && attendanceEnabled &&
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
              action={lifecycleAction} onSelect={() => ui.setFieldValue('action', lifecycleAction)} />
          </section>
        </div>
      )}
      {placement !== 'settings' && (
        <LifecycleTrigger scope={scope} visible={active && overview.planCount > 0}
          menu={placement === 'menu'} action={lifecycleAction}
          onSelect={() => ui.setFieldValue('action', lifecycleAction)} />
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
                onClose={() => ui.setFieldValue('action', '')}
              />
            </RequirePermissions>
          )
        }
      </ui.Subscribe>
    </>
  );
}
function LifecycleTrigger({ scope, visible, action, onSelect, menu = false }: {
  scope: ExamScope; visible: boolean; action: Exclude<Action, '' | 'working-days'>;
  onSelect: () => void; menu?: boolean;
}) {
  if (!visible) return null;
  const Icon = action === 'start' ? Play : action === 'complete' ? CheckCircle2 : RotateCcw;
  return (
    <RequirePermissions permissions={schoolPermission(scope.schoolId, SCHOOL_ACTIONS.TRANSITION_EXAM_PLAN)}>
      {menu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="Examination actions"><MoreVertical aria-hidden /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onSelect}><Icon aria-hidden />{actionLabel(action)}</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <ExamButton variant="outline" onClick={onSelect}><Icon aria-hidden />{actionLabel(action)}</ExamButton>
      )}
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
function actionLabel(action: Exclude<Action, '' | 'working-days'>) {
  return {
    start: 'Start examination',
    complete: 'Complete examination',
    reopen: 'Reopen examination',
  }[action];
}
function ExamActionDialog({
  scope,
  action,
  initial,
  onClose,
}: {
  scope: ExamScope;
  action: Exclude<Action, ''>;
  initial: number | null;
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
                {workingDays
                  ? 'Set the maximum number of attendance days for this examination.'
                  : action === 'start'
                    ? 'Start result entry for every class. Only the principal, manager or exam coordinator can start an examination.'
                    : action === 'complete'
                      ? 'All student results must be approved. Completing the examination makes results and timetable read-only.'
                      : 'Reopen result entry for every class. Saved marks and approvals are preserved.'}
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
                <ExamButton type="submit" disabled={pending || !canSubmit}>
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

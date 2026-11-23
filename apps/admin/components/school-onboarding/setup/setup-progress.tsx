'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Check, Circle, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { SchoolSetupDto } from '@campuspilot/api/routers/system-admin/school-setup/school-setup.dto';
import { SCHOOL_SETUP_RUN_STEPS, SCHOOL_SETUP_RUN_STEP_LABELS, type SchoolSetupRunStep } from '@campuspilot/api/school-setup/school-setup.contract';
import { IssuedStaffPasswordDialog, type IssuedStaffPasswordDetails } from '@campuspilot/components/staff-account/issued-staff-password-dialog';
import { Alert, AlertDescription, AlertTitle } from '@campuspilot/ui/components/alert';
import { Button } from '@campuspilot/ui/components/button';
import { client } from '@/lib/orpc';

type StepState = 'done' | 'running' | 'failed' | 'waiting';

function stepState(setup: SchoolSetupDto, step: SchoolSetupRunStep): StepState {
  if (setup.completedSteps.includes(step)) return 'done';
  if (setup.status === 'failed' && (setup.error?.step === step || setup.currentStep === step)) return 'failed';
  if (setup.status === 'running' && setup.currentStep === step) return 'running';
  return 'waiting';
}

const ICONS: Record<StepState, typeof Check> = { done: Check, running: LoaderCircle, failed: TriangleAlert, waiting: Circle };
const ICON_CLASSES: Record<StepState, string> = {
  done: 'text-emerald-600',
  running: 'animate-spin text-primary',
  failed: 'text-destructive',
  waiting: 'text-muted-foreground/50',
};

function StepList({ setup }: { setup: SchoolSetupDto }) {
  return (
    <ol className="flex flex-col gap-3">
      {SCHOOL_SETUP_RUN_STEPS.map((step) => {
        const state = stepState(setup, step);
        const Icon = ICONS[state];
        return (
          <li key={step} className="flex items-center gap-3 text-sm">
            <Icon className={`size-4 ${ICON_CLASSES[state]}`} aria-hidden />
            <span className={state === 'waiting' ? 'text-muted-foreground' : ''}>{SCHOOL_SETUP_RUN_STEP_LABELS[step]}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Issues the new principal's first password, shown once, through the school's own procedure. */
function IssuePrincipalPassword({ result }: { result: NonNullable<SchoolSetupDto['result']> }) {
  const [details, setDetails] = useState<IssuedStaffPasswordDetails | null>(null);
  const issue = useMutation({
    mutationFn: () => client.school.issueMemberPassword({ schoolId: result.schoolId, userId: result.principalUserId }),
    onSuccess: (issued) => setDetails(issued),
  });
  return (
    <>
      <Button type="button" disabled={issue.isPending} onClick={() => issue.mutate()}>
        {issue.isPending ? 'Issuing…' : "Issue the principal's password"}
      </Button>
      {issue.error ? <p className="text-sm text-destructive">{issue.error.message}</p> : null}
      <IssuedStaffPasswordDialog details={details} onClose={() => setDetails(null)} />
    </>
  );
}

function Succeeded({ setup }: { setup: SchoolSetupDto }) {
  const result = setup.result;
  if (!result) return null;
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <Check aria-hidden />
        <AlertTitle>{setup.draft.school.name} is set up</AlertTitle>
        <AlertDescription>
          {result.classCount} classes and {result.examCount} examinations in the active session.
          {result.principalHasPassword ? ' The principal signs in with their existing password.' : ' The principal has no password yet: issue one and share it with them.'}
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2">
        {result.principalHasPassword ? null : <IssuePrincipalPassword result={result} />}
        <Button asChild variant="outline">
          <Link href={`/school/${result.schoolId}`}>Open the school</Link>
        </Button>
      </div>
    </div>
  );
}

function Failed({ setup, onEdit, onRetry, retrying }: { setup: SchoolSetupDto; onEdit: () => void; onRetry: () => void; retrying: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="destructive">
        <TriangleAlert aria-hidden />
        <AlertTitle>The setup stopped</AlertTitle>
        <AlertDescription>{setup.error?.message ?? 'Something went wrong.'}</AlertDescription>
      </Alert>
      <p className="text-sm text-muted-foreground">
        Retrying continues from the step that stopped; finished steps are not repeated. {setup.schoolId ? 'The school already exists, so edits only affect the steps still to run.' : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={retrying} onClick={onRetry}>
          {retrying ? 'Starting…' : 'Retry'}
        </Button>
        <Button type="button" variant="outline" onClick={onEdit}>
          Edit the setup
        </Button>
      </div>
    </div>
  );
}

/**
 * The run's progress: each workflow step as it runs (the page polls while the
 * setup is queued or running), then the outcome: the new school with the
 * principal's password to issue, or the failure with Retry and Edit.
 */
export function SetupProgress({ setup, onEdit, onRetry, retrying }: { setup: SchoolSetupDto; onEdit: () => void; onRetry: () => void; retrying: boolean }) {
  const waiting = setup.status === 'queued' ? (setup.lastSubmitError ? `Waiting for the workflow engine: ${setup.lastSubmitError}` : 'Queued; waiting for the worker…') : null;
  return (
    <div className="flex flex-col gap-6 rounded-xl border p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Setting up {setup.draft.school.name}</h2>
        {waiting ? <p className="text-sm text-muted-foreground">{waiting}</p> : null}
      </div>
      <StepList setup={setup} />
      {setup.status === 'succeeded' ? <Succeeded setup={setup} /> : null}
      {setup.status === 'failed' ? <Failed setup={setup} onEdit={onEdit} onRetry={onRetry} retrying={retrying} /> : null}
    </div>
  );
}

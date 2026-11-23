'use client';

import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { client, orpc } from '@/lib/orpc';
import { SetupProgress } from './setup-progress';
import { SetupWizardForm } from './setup-wizard';

/** While the setup is queued or running the page re-reads it every 1.5 s; otherwise it is read once. */
const POLL_MS = 1_500;

/**
 * Setting up a school from one School Onboarding submission: the wizard while
 * it is a draft (or being edited after a failure), the run's progress and
 * outcome once it was started.
 */
export function SchoolSetupPage({ requestId }: { requestId: string }) {
  const queryClient = useQueryClient();
  const options = orpc.systemAdmin.getSchoolSetup.queryOptions({ input: { requestId } });
  const { data } = useSuspenseQuery({
    ...options,
    refetchInterval: (query) => (query.state.data?.setup && ['queued', 'running'].includes(query.state.data.setup.status) ? POLL_MS : false),
  });
  // Whether a failed setup is being edited instead of shown; a view choice, not form input.
  const [editingFailed, setEditingFailed] = useState(false);
  const retry = useMutation({
    mutationFn: () => {
      const setup = data.setup!;
      return client.systemAdmin.startSchoolSetup({ requestId, draft: setup.draft, step: setup.draftStep });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: options.queryKey }),
  });
  const setup = data.setup;
  const showProgress = setup !== null && setup.status !== 'draft' && !(setup.status === 'failed' && editingFailed);
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Set up {setup?.draft.school.name || data.proposedDraft.school.name || 'the school'}</h1>
        <p className="text-sm text-muted-foreground">From the School Onboarding form. Your answers are saved as a draft; you can leave and continue later.</p>
      </div>
      {showProgress ? (
        <SetupProgress setup={setup} onEdit={() => setEditingFailed(true)} onRetry={() => retry.mutate()} retrying={retry.isPending} />
      ) : (
        <SetupWizardForm
          key={setup?.attempt ?? 0}
          requestId={requestId}
          hasLogo={data.hasLogo}
          initial={{ step: setup?.draftStep ?? 'school', draft: setup?.draft ?? data.proposedDraft }}
          savedAt={setup?.draftUpdatedAt ?? null}
          onStarted={() => {
            setEditingFailed(false);
            void queryClient.invalidateQueries({ queryKey: options.queryKey });
          }}
        />
      )}
      {retry.error ? <p className="text-sm text-destructive">{retry.error.message}</p> : null}
    </section>
  );
}

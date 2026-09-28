'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { AppShellAlert } from '@campuspilot/components/app-shell';
import {
  SessionDetailsView,
  type SessionConfig,
} from '@campuspilot/components/session';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@campuspilot/ui/components/alert-dialog';
import { Button } from '@campuspilot/ui/components/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@campuspilot/ui/components/empty';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { RequirePermissions } from '@/components/require-permissions';
import { schoolHref } from '@/components/school-route';
import { client, orpc } from '@/lib/orpc';
import { SessionFinanceSettings } from './session-finance-settings';

export function SessionDetail({
  schoolId,
  sessionId,
}: {
  schoolId: string;
  sessionId: string;
}) {
  const resource = { kind: 'school' as const, schoolId };
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isSessionDirty, setIsSessionDirty] = useState(false);
  const [isFinanceDirty, setIsFinanceDirty] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const sessionQuery = useQuery(
    orpc.school.getSession.queryOptions({ input: { schoolId, sessionId } }),
  );
  const session = sessionQuery.data;
  const updateSessionMutation = useMutation({
    mutationFn: (payload: { sessionConfig: SessionConfig | null }) =>
      client.school.updateSession({ schoolId, sessionId, ...payload }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.school.getSession.queryKey({
          input: { schoolId, sessionId },
        }),
      });
      await queryClient.invalidateQueries({
        queryKey: orpc.school.listSessions.queryKey({ input: { schoolId } }),
      });
    },
  });
  const activateSessionMutation = useMutation({
    mutationFn: () => client.school.activateSession({ schoolId, sessionId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.school.getSession.queryKey({
          input: { schoolId, sessionId },
        }),
      });
      await queryClient.invalidateQueries({
        queryKey: orpc.school.listSessions.queryKey({ input: { schoolId } }),
      });
    },
  });
  const deleteSessionMutation = useMutation({
    mutationFn: () => client.school.deleteSession({ schoolId, sessionId }),
    onSuccess: async () => {
      setIsDeleteOpen(false);
      await queryClient.invalidateQueries({
        queryKey: orpc.school.listSessions.queryKey({ input: { schoolId } }),
      });
      router.push(schoolHref(schoolId, '/settings/session'));
    },
  });

  if (sessionQuery.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-4xl animate-pulse flex-col gap-6">
        <div className="h-16 rounded-xl border border-border bg-muted/40" />
        <div className="h-64 rounded-xl border border-border bg-muted/40" />
        <div className="h-48 rounded-xl border border-border bg-muted/40" />
      </div>
    );
  }

  if (sessionQuery.isError || !session) {
    return (
      <Empty className="mx-auto max-w-4xl border border-dashed p-10">
        <EmptyHeader>
          <EmptyTitle>Academic session not found</EmptyTitle>
          <EmptyDescription>
            The requested academic session does not exist or has been removed.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const readOnlySession = <SessionDetailsView session={session} />;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      {isSessionDirty ? (
        <AppShellAlert
          slug="session/academic/unsaved"
          message="Examination and academic settings have unsaved changes."
        />
      ) : null}
      {isFinanceDirty ? (
        <AppShellAlert
          slug="session/finance/unsaved"
          message="Financial settings have unsaved changes."
        />
      ) : null}
      {session.isActive ? (
        <RequirePermissions
          permissions={{ action: SCHOOL_ACTIONS.UPDATE_SESSION, resource }}
          fallback={readOnlySession}
        >
          <SessionDetailsView
            session={session}
            isSaving={updateSessionMutation.isPending}
            onSave={async (updates) => {
              await updateSessionMutation.mutateAsync(updates);
            }}
            onDirtyChange={setIsSessionDirty}
          />
        </RequirePermissions>
      ) : (
        <RequirePermissions
          permissions={{ action: SCHOOL_ACTIONS.ACTIVATE_SESSION, resource }}
          fallback={readOnlySession}
        >
          <SessionDetailsView
            session={session}
            isActivating={activateSessionMutation.isPending}
            onActivate={() => activateSessionMutation.mutate()}
          />
        </RequirePermissions>
      )}

      <RequirePermissions
        permissions={{ action: SCHOOL_ACTIONS.READ_SESSION_FINANCE, resource }}
      >
        <SessionFinanceSettings
          schoolId={schoolId}
          sessionId={session.id}
          isActive={session.isActive}
          onDirtyChange={setIsFinanceDirty}
        />
      </RequirePermissions>

      {!session.isActive ? (
        <RequirePermissions
          permissions={{ action: SCHOOL_ACTIONS.DELETE_SESSION, resource }}
        >
          <div className="flex flex-col gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-destructive">
                Delete academic session
              </h3>
              <p className="text-xs text-muted-foreground">
                Permanently remove session {session.sessionStartYear}&ndash;
                {session.sessionEndYear} and its associated configurations.
                This action cannot be undone.
              </p>
            </div>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="w-fit shrink-0 gap-1.5"
              onClick={() => setIsDeleteOpen(true)}
            >
              <Trash2 className="size-3.5" />
              <span>Delete session</span>
            </Button>
          </div>

          <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete session {session.sessionStartYear}&ndash;
                  {session.sessionEndYear}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove this academic session and its
                  configuration. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteSessionMutation.isPending}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={deleteSessionMutation.isPending}
                  onClick={() => deleteSessionMutation.mutate()}
                >
                  {deleteSessionMutation.isPending ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                  Delete session
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </RequirePermissions>
      ) : null}
    </div>
  );
}

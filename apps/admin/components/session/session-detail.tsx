'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShellAlert } from '@campuspilot/components/app-shell';
import {
  SessionDetailsView,
  UnsavedChangesDialog,
  type SchoolSessionDto,
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
import { schoolHref } from '@/app/(protected)/school/[schoolId]/school-route';
import { client, orpc } from '@/lib/orpc';
import { SessionFinanceSettings } from './session-finance-settings';


export function SessionDetail({
  schoolId,
  sessionId,
}: {
  schoolId: string;
  sessionId: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isSessionDirty, setIsSessionDirty] = useState(false);
  const [isFinanceDirty, setIsFinanceDirty] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [pendingNavigationUrl, setPendingNavigationUrl] = useState<
    string | null
  >(null);
  const isDirty = isSessionDirty || isFinanceDirty;

  /**
   * User-approved navigation interceptor:
   * Prevents losing unsaved session changes on link clicks, browser history navigation, or tab reload.
   */
  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a') as HTMLAnchorElement | null;
      if (!anchor || !anchor.href) return;

      if (
        anchor.href.startsWith('mailto:') ||
        anchor.href.startsWith('tel:') ||
        anchor.href.startsWith('javascript:')
      ) {
        return;
      }

      const url = new URL(anchor.href, window.location.href);
      if (
        url.origin === window.location.origin &&
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setPendingNavigationUrl(anchor.href);
    };

    const handlePopState = () => {
      window.history.pushState(null, '', window.location.href);
      setPendingNavigationUrl('BACK');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleDocumentClick, { capture: true });
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleDocumentClick, {
        capture: true,
      });
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isDirty]);


  const sessionQuery = useQuery(
    orpc.school.getSession.queryOptions({
      input: { schoolId, sessionId },
    }),
  );

  const session = sessionQuery.data;

  // Mutations
  const updateSessionMutation = useMutation({
    mutationFn: async (payload: { sessionConfig: SessionConfig | null }) => {
      if (!session) return;
      return await client.school.updateSession({
        schoolId,
        sessionId: session.id,
        sessionConfig: payload.sessionConfig,
      });
    },
    onSuccess: (updated) => {
      if (updated) {
        setIsSessionDirty(false);
        void queryClient.invalidateQueries({
          queryKey: orpc.school.getSession.queryKey({
            input: { schoolId, sessionId },
          }),
        });
        void queryClient.invalidateQueries({
          queryKey: orpc.school.listSessions.queryKey({
            input: { schoolId },
          }),
        });
      }
    },
  });

  const activateSessionMutation = useMutation({
    mutationFn: async () => {
      if (!session) return;
      return await client.school.activateSession({
        schoolId,
        sessionId: session.id,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.school.getSession.queryKey({
          input: { schoolId, sessionId },
        }),
      });
      void queryClient.invalidateQueries({
        queryKey: orpc.school.listSessions.queryKey({
          input: { schoolId },
        }),
      });
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async () => {
      if (!session) return;
      return await client.school.deleteSession({
        schoolId,
        sessionId: session.id,
      });
    },
    onSuccess: () => {
      setIsDeleteOpen(false);
      setIsSessionDirty(false);
      setIsFinanceDirty(false);
      void queryClient.invalidateQueries({
        queryKey: orpc.school.listSessions.queryKey({
          input: { schoolId },
        }),
      });
      router.push(schoolHref(schoolId, '/sessions'));
    },
  });

  if (sessionQuery.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 animate-pulse">
        <div className="h-16 rounded-xl border border-border bg-muted/40" />
        <div className="h-64 rounded-xl border border-border bg-muted/40" />
        <div className="h-48 rounded-xl border border-border bg-muted/40" />
      </div>
    );
  }

  if (sessionQuery.isError || !session) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <Empty className="border border-dashed p-10">
          <EmptyHeader>
            <EmptyTitle>Academic session not found</EmptyTitle>
            <EmptyDescription>
              The requested academic session does not exist or has been removed.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

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
      {/* Main Session View & Editor */}
      <SessionDetailsView
        key={session.id}
        session={session as SchoolSessionDto}
        isSaving={updateSessionMutation.isPending}
        isActivating={activateSessionMutation.isPending}
        onActivate={() => activateSessionMutation.mutate()}
        onSave={
          session.isActive
            ? async (updates) => {
                await updateSessionMutation.mutateAsync(updates);
              }
            : undefined
        }
        onDirtyChange={session.isActive ? setIsSessionDirty : undefined}
      />

      <SessionFinanceSettings
        schoolId={schoolId}
        sessionId={session.id}
        isEditable={session.isActive}
        onDirtyChange={setIsFinanceDirty}
      />

      {!session.isActive ? (
        <>
          {/* Danger Zone: Delete Session at the lowermost portion */}
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

          {/* Delete Session Confirmation */}
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
        </>
      ) : null}

      {/* Unsaved Changes Confirmation Dialog */}
      <UnsavedChangesDialog
        open={Boolean(pendingNavigationUrl)}
        onOpenChange={(open) => {
          if (!open) setPendingNavigationUrl(null);
        }}
        onConfirmDiscard={() => {
          const target = pendingNavigationUrl;
          setPendingNavigationUrl(null);
          setIsSessionDirty(false);
          setIsFinanceDirty(false);
          if (target === 'BACK') {
            window.history.back();
          } else if (target) {
            router.push(target);
          }
        }}
      />
    </div>
  );
}

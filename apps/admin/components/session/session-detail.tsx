'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SessionDetailsView,
  UnsavedChangesDialog,
  type FinanceSchemaConfig,
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
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@campuspilot/ui/components/empty';
import {
  CalendarDays,
  CheckCircle2,
  LoaderCircle,
  Trash2,
} from 'lucide-react';
import { schoolHref } from '@/app/(protected)/school/[schoolId]/school-route';
import { client, orpc } from '@/lib/orpc';

export function SessionDetail({
  schoolId,
  sessionId,
}: {
  schoolId: string;
  sessionId: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isDirty, setIsDirty] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  /**
   * User-approved beforeunload listener: Warns user on accidental browser reload
   * or tab close if there are pending unsaved changes.
   */
  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const sessionQuery = useQuery(
    orpc.school.getSession.queryOptions({
      input: { schoolId, sessionId },
    }),
  );

  const session = sessionQuery.data;

  // Mutations
  const updateSessionMutation = useMutation({
    mutationFn: async (payload: {
      sessionConfig: SessionConfig | null;
      financeConfig: FinanceSchemaConfig | null;
    }) => {
      if (!session) return;
      return await client.school.updateSession({
        schoolId,
        sessionId: session.id,
        sessionConfig: payload.sessionConfig,
        financeConfig: payload.financeConfig,
      });
    },
    onSuccess: (updated) => {
      if (updated) {
        setIsDirty(false);
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
      setIsDirty(false);
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
      {/* Top Toolbar: Session Status and Actions */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold tracking-tight">
            Academic session {session.sessionStartYear}&ndash;{session.sessionEndYear}
          </span>

          {session.isActive ? (
            <Badge
              variant="outline"
              className="border-emerald-500/30 text-[10px] text-emerald-600 dark:text-emerald-400"
            >
              Active
            </Badge>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={activateSessionMutation.isPending}
              onClick={() => activateSessionMutation.mutate()}
            >
              {activateSessionMutation.isPending ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <CheckCircle2 className="size-3 text-emerald-600" />
              )}
              Set as active
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setIsDeleteOpen(true)}
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </div>
      </div>

      {/* Main Session View & Editor */}
      <SessionDetailsView
        key={session.id}
        session={session as SchoolSessionDto}
        isSaving={updateSessionMutation.isPending}
        onSave={async (updates) => {
          await updateSessionMutation.mutateAsync(updates);
        }}
        onDirtyChange={setIsDirty}
      />

      {/* Delete Session Confirmation */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete session {session.sessionStartYear}&ndash;{session.sessionEndYear}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this academic session and its configuration. This action cannot be undone.
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
    </div>
  );
}

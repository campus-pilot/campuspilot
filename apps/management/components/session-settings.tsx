'use client';

import { useMemo, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import {
  SessionDetailsView,
  SessionFinanceView,
  UnsavedChangesDialog,
  type FinanceClassOverrides,
  type FinanceSchemaConfig,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@campuspilot/ui/components/empty';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@campuspilot/ui/components/native-select';
import { CalendarDays, CheckCircle2, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { client, orpc } from '@/lib/orpc';
import { RequirePermissions } from './require-permissions';

const newSessionSchema = z
  .object({
    sessionStartYear: z.number().int().min(2000).max(2100),
    sessionEndYear: z.number().int().min(2000).max(2100),
  })
  .refine((value) => value.sessionEndYear > value.sessionStartYear, {
    message: 'End year must be after start year.',
    path: ['sessionEndYear'],
  });

function FieldErrors({ errors }: { errors: unknown[] }) {
  return errors.map((error, index) => {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : undefined;
    return message ? (
      <p key={`${message}-${index}`} className="text-xs text-destructive">
        {message}
      </p>
    ) : null;
  });
}

function CreateSessionDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: {
    sessionStartYear: number;
    sessionEndYear: number;
  }) => Promise<void>;
  isSubmitting: boolean;
}) {
  const currentYear = new Date().getFullYear();
  const form = useForm({
    defaultValues: {
      sessionStartYear: currentYear,
      sessionEndYear: currentYear + 1,
    },
    validators: { onSubmit: newSessionSchema },
    onSubmit: async ({ value }) => {
      try {
        await onSubmit(value);
        onOpenChange(false);
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            form:
              error instanceof Error
                ? error.message
                : 'Unable to create the academic session.',
            fields: {},
          },
        });
      }
    },
  });

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && isSubmitting) return;
    if (!nextOpen) form.reset();
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New academic session</DialogTitle>
          <DialogDescription>
            Specify the academic year boundaries for the new session.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <form.Field name="sessionStartYear">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="session-start-year">Start year</Label>
                  <Input
                    id="session-start-year"
                    type="number"
                    min={2000}
                    max={2100}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      const year = Number(event.target.value);
                      field.handleChange(year);
                      form.setFieldValue('sessionEndYear', year + 1);
                    }}
                  />
                  <FieldErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            <form.Field name="sessionEndYear">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="session-end-year">End year</Label>
                  <Input
                    id="session-end-year"
                    type="number"
                    min={2000}
                    max={2100}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) =>
                      field.handleChange(Number(event.target.value))
                    }
                  />
                  <FieldErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
          </div>
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              errors: state.errors,
            })}
          >
            {({ canSubmit, errors }) => (
              <>
                <FieldErrors errors={errors} />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSubmitting}
                    onClick={() => handleOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!canSubmit || isSubmitting}>
                    {isSubmitting ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Plus />
                    )}
                    Create session
                  </Button>
                </DialogFooter>
              </>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SessionFinanceSettings({
  schoolId,
  sessionId,
  onDirtyChange,
}: {
  schoolId: string;
  sessionId: string;
  onDirtyChange: (isDirty: boolean) => void;
}) {
  const resource = { kind: 'school' as const, schoolId };
  const queryClient = useQueryClient();
  const financeQuery = useQuery(
    orpc.school.getSessionFinance.queryOptions({
      input: { schoolId, sessionId },
    }),
  );
  const updateMutation = useMutation({
    mutationFn: (updates: {
      financeConfig: FinanceSchemaConfig | null;
      classOverrides: FinanceClassOverrides;
    }) =>
      client.school.updateSessionFinance({
        schoolId,
        sessionId,
        ...updates,
      }),
    onSuccess: async () => {
      onDirtyChange(false);
      await queryClient.invalidateQueries({
        queryKey: orpc.school.getSessionFinance.queryKey({
          input: { schoolId, sessionId },
        }),
      });
    },
  });

  if (financeQuery.isPending) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  }

  if (financeQuery.isError) {
    return (
      <Empty className="border border-dashed p-8">
        <EmptyHeader>
          <EmptyTitle>Unable to load financial configuration</EmptyTitle>
          <EmptyDescription>
            {financeQuery.error instanceof Error
              ? financeQuery.error.message
              : 'Try refreshing the page.'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <RequirePermissions
      permissions={{
        action: SCHOOL_ACTIONS.UPDATE_SESSION_FINANCE,
        resource,
      }}
      fallback={
        <SessionFinanceView
          key={sessionId}
          finance={financeQuery.data}
          onDirtyChange={onDirtyChange}
        />
      }
    >
      <SessionFinanceView
        key={sessionId}
        finance={financeQuery.data}
        isSaving={updateMutation.isPending}
        onSave={async (updates) => {
          await updateMutation.mutateAsync(updates);
        }}
        onDirtyChange={onDirtyChange}
      />
    </RequirePermissions>
  );
}

export function SessionSettings({ schoolId }: { schoolId: string }) {
  const resource = { kind: 'school' as const, schoolId };
  const queryClient = useQueryClient();
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [pendingSessionId, setPendingSessionId] = useState<string>();
  const [isSessionDirty, setIsSessionDirty] = useState(false);
  const [isFinanceDirty, setIsFinanceDirty] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const isDirty = isSessionDirty || isFinanceDirty;
  const sessionsQuery = useQuery(
    orpc.school.listSessions.queryOptions({ input: { schoolId } }),
  );
  const sessions = useMemo(
    () => sessionsQuery.data?.items ?? [],
    [sessionsQuery.data?.items],
  );
  const currentSession = useMemo(() => {
    const selected = sessions.find(({ id }) => id === selectedSessionId);
    return selected ?? sessions.find(({ isActive }) => isActive) ?? sessions[0];
  }, [selectedSessionId, sessions]);

  const updateMutation = useMutation({
    mutationFn: (updates: { sessionConfig: SessionConfig | null }) => {
      if (!currentSession) throw new Error('No academic session is selected.');
      return client.school.updateSession({
        schoolId,
        sessionId: currentSession.id,
        ...updates,
      });
    },
    onSuccess: async () => {
      setIsSessionDirty(false);
      await queryClient.invalidateQueries({
        queryKey: orpc.school.listSessions.queryKey({ input: { schoolId } }),
      });
    },
  });
  const createMutation = useMutation({
    mutationFn: (value: {
      sessionStartYear: number;
      sessionEndYear: number;
    }) => client.school.createSession({ schoolId, ...value }),
    onSuccess: async (created) => {
      setSelectedSessionId(created.id);
      setIsSessionDirty(false);
      setIsFinanceDirty(false);
      await queryClient.invalidateQueries({
        queryKey: orpc.school.listSessions.queryKey({ input: { schoolId } }),
      });
    },
  });
  const activateMutation = useMutation({
    mutationFn: () => {
      if (!currentSession) throw new Error('No academic session is selected.');
      return client.school.activateSession({
        schoolId,
        sessionId: currentSession.id,
      });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: orpc.school.listSessions.queryKey({ input: { schoolId } }),
      }),
  });
  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!currentSession) throw new Error('No academic session is selected.');
      return client.school.deleteSession({
        schoolId,
        sessionId: currentSession.id,
      });
    },
    onSuccess: async () => {
      setIsDeleteOpen(false);
      setSelectedSessionId(undefined);
      setIsSessionDirty(false);
      setIsFinanceDirty(false);
      await queryClient.invalidateQueries({
        queryKey: orpc.school.listSessions.queryKey({ input: { schoolId } }),
      });
    },
  });

  function handleSelectSession(nextId: string) {
    if (nextId === currentSession?.id) return;
    if (isDirty) {
      setPendingSessionId(nextId);
      return;
    }
    setSelectedSessionId(nextId);
  }

  if (sessionsQuery.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-4xl animate-pulse flex-col gap-6">
        <div className="h-16 rounded-xl bg-muted" />
        <div className="h-64 rounded-xl bg-muted" />
      </div>
    );
  }

  if (sessionsQuery.isError) {
    return (
      <Empty className="mx-auto max-w-4xl border border-dashed p-10">
        <EmptyHeader>
          <EmptyTitle>Unable to load academic sessions</EmptyTitle>
          <EmptyDescription>
            {sessionsQuery.error instanceof Error
              ? sessionsQuery.error.message
              : 'Try refreshing the page.'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (!currentSession) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <Empty className="border border-dashed p-10">
          <EmptyHeader>
            <EmptyTitle>No academic sessions found</EmptyTitle>
            <EmptyDescription>
              Create a session to configure exams, grading, attendance, and finance.
            </EmptyDescription>
          </EmptyHeader>
          <RequirePermissions
            permissions={{ action: SCHOOL_ACTIONS.CREATE_SESSION, resource }}
          >
            <EmptyContent>
              <Button size="sm" onClick={() => setIsCreateOpen(true)}>
                <Plus />
                Create first session
              </Button>
            </EmptyContent>
          </RequirePermissions>
        </Empty>
        <RequirePermissions
          permissions={{ action: SCHOOL_ACTIONS.CREATE_SESSION, resource }}
        >
          <CreateSessionDialog
            open={isCreateOpen}
            onOpenChange={setIsCreateOpen}
            onSubmit={async (value) => {
              await createMutation.mutateAsync(value);
            }}
            isSubmitting={createMutation.isPending}
          />
        </RequirePermissions>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <Label htmlFor="session-switcher">Session:</Label>
          <NativeSelect
            id="session-switcher"
            value={currentSession.id}
            onChange={(event) => handleSelectSession(event.target.value)}
          >
            {sessions.map((session) => (
              <NativeSelectOption key={session.id} value={session.id}>
                {session.sessionStartYear}&ndash;{session.sessionEndYear}
                {session.isActive ? ' (Active)' : ''}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {currentSession.isActive ? (
            <Badge variant="outline">Active</Badge>
          ) : (
            <RequirePermissions
              permissions={{ action: SCHOOL_ACTIONS.ACTIVATE_SESSION, resource }}
            >
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={activateMutation.isPending}
                onClick={() => activateMutation.mutate()}
              >
                <CheckCircle2 />
                Set as active
              </Button>
            </RequirePermissions>
          )}
        </div>
        <div className="flex items-center gap-2">
          <RequirePermissions
            permissions={{ action: SCHOOL_ACTIONS.DELETE_SESSION, resource }}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setIsDeleteOpen(true)}
            >
              <Trash2 />
              Delete
            </Button>
          </RequirePermissions>
          <RequirePermissions
            permissions={{ action: SCHOOL_ACTIONS.CREATE_SESSION, resource }}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus />
              New session
            </Button>
          </RequirePermissions>
        </div>
      </div>

      <RequirePermissions
        permissions={{ action: SCHOOL_ACTIONS.UPDATE_SESSION, resource }}
        fallback={<SessionDetailsView key={currentSession.id} session={currentSession} />}
      >
        <SessionDetailsView
          key={currentSession.id}
          session={currentSession}
          isSaving={updateMutation.isPending}
          onSave={async (updates) => {
            await updateMutation.mutateAsync(updates);
          }}
          onDirtyChange={setIsSessionDirty}
        />
      </RequirePermissions>

      <RequirePermissions
        permissions={{ action: SCHOOL_ACTIONS.READ_SESSION_FINANCE, resource }}
      >
        <SessionFinanceSettings
          key={currentSession.id}
          schoolId={schoolId}
          sessionId={currentSession.id}
          onDirtyChange={setIsFinanceDirty}
        />
      </RequirePermissions>

      <UnsavedChangesDialog
        open={pendingSessionId !== undefined}
        onOpenChange={(open) => !open && setPendingSessionId(undefined)}
        onConfirmDiscard={() => {
          setSelectedSessionId(pendingSessionId);
          setPendingSessionId(undefined);
          setIsSessionDirty(false);
          setIsFinanceDirty(false);
        }}
      />
      <RequirePermissions
        permissions={{ action: SCHOOL_ACTIONS.CREATE_SESSION, resource }}
      >
        <CreateSessionDialog
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          onSubmit={async (value) => {
            await createMutation.mutateAsync(value);
          }}
          isSubmitting={createMutation.isPending}
        />
      </RequirePermissions>
      <RequirePermissions
        permissions={{ action: SCHOOL_ACTIONS.DELETE_SESSION, resource }}
      >
        <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete session {currentSession.sessionStartYear}&ndash;
                {currentSession.sessionEndYear}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the session and its configuration.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete session'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </RequirePermissions>
    </div>
  );
}

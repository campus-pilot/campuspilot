'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
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
import {
  CalendarDays,
  CheckCircle2,
  LoaderCircle,
  Plus,
  Trash2,
} from 'lucide-react';
import { client, orpc } from '@/lib/orpc';
import { SessionFinanceSettings } from './session-finance-settings';

const newSessionSchema = z
  .object({
    sessionStartYear: z
      .number({ message: 'Start year is required' })
      .int()
      .min(2000, 'Start year must be at least 2000')
      .max(2100, 'Start year cannot exceed 2100'),
    sessionEndYear: z
      .number({ message: 'End year is required' })
      .int()
      .min(2000, 'End year must be at least 2000')
      .max(2100, 'End year cannot exceed 2100'),
  })
  .refine((data) => data.sessionEndYear > data.sessionStartYear, {
    message: 'End year must be after start year',
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

interface CreateSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: {
    sessionStartYear: number;
    sessionEndYear: number;
  }) => Promise<void>;
  isSubmitting: boolean;
}

function CreateSessionDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
}: CreateSessionDialogProps) {
  const currentYear = new Date().getFullYear();
  const form = useForm({
    defaultValues: {
      sessionStartYear: currentYear,
      sessionEndYear: currentYear + 1,
    },
    validators: { onSubmit: newSessionSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                  <Label htmlFor="start-year">Start year</Label>
                  <Input
                    id="start-year"
                    type="number"
                    min={2000}
                    max={2100}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      const start = Number(event.target.value);
                      field.handleChange(start);
                      form.setFieldValue('sessionEndYear', start + 1);
                    }}
                  />
                  <FieldErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>

            <form.Field name="sessionEndYear">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="end-year">End year</Label>
                  <Input
                    id="end-year"
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
            })}
          >
            {({ canSubmit }) => (
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  Create session
                </Button>
              </DialogFooter>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SessionManagement({ schoolId }: { schoolId: string }) {
  const queryClient = useQueryClient();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isSessionDirty, setIsSessionDirty] = useState(false);
  const [isFinanceDirty, setIsFinanceDirty] = useState(false);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const isDirty = isSessionDirty || isFinanceDirty;

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

  // Query all sessions for this school
  const sessionsQuery = useQuery(
    orpc.school.listSessions.queryOptions({
      input: {
        schoolId,
      },
    }),
  );

  const sessions = useMemo(
    () => sessionsQuery.data?.items ?? [],
    [sessionsQuery.data?.items],
  );

  // Active session or first session as default selection
  const currentSession = useMemo(() => {
    if (sessions.length === 0) return null;
    if (selectedSessionId) {
      const found = sessions.find((s) => s.id === selectedSessionId);
      if (found) return found;
    }
    const active = sessions.find((s) => s.isActive);
    return active ?? sessions[0] ?? null;
  }, [sessions, selectedSessionId]);

  // Mutations
  const updateSessionMutation = useMutation({
    mutationFn: async (payload: { sessionConfig: SessionConfig | null }) => {
      if (!currentSession) return;
      return await client.school.updateSession({
        schoolId,
        sessionId: currentSession.id,
        sessionConfig: payload.sessionConfig,
      });
    },
    onSuccess: (updated) => {
      if (updated) {
        setIsSessionDirty(false);
        void queryClient.invalidateQueries({
          queryKey: orpc.school.listSessions.queryKey({
            input: { schoolId },
          }),
        });
      }
    },
  });

  const createSessionMutation = useMutation({
    mutationFn: async (values: {
      sessionStartYear: number;
      sessionEndYear: number;
    }) => {
      return await client.school.createSession({
        schoolId,
        sessionStartYear: values.sessionStartYear,
        sessionEndYear: values.sessionEndYear,
      });
    },
    onSuccess: (created) => {
      setSelectedSessionId(created.id);
      setIsSessionDirty(false);
      setIsFinanceDirty(false);
      void queryClient.invalidateQueries({
        queryKey: orpc.school.listSessions.queryKey({
          input: { schoolId },
        }),
      });
    },
  });

  const activateSessionMutation = useMutation({
    mutationFn: async () => {
      if (!currentSession) return;
      return await client.school.activateSession({
        schoolId,
        sessionId: currentSession.id,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.school.listSessions.queryKey({
          input: { schoolId },
        }),
      });
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async () => {
      if (!currentSession) return;
      return await client.school.deleteSession({
        schoolId,
        sessionId: currentSession.id,
      });
    },
    onSuccess: () => {
      setIsDeleteOpen(false);
      setSelectedSessionId(null);
      setIsSessionDirty(false);
      setIsFinanceDirty(false);
      void queryClient.invalidateQueries({
        queryKey: orpc.school.listSessions.queryKey({
          input: { schoolId },
        }),
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

  function handleConfirmDiscardNavigation() {
    if (pendingSessionId) {
      setSelectedSessionId(pendingSessionId);
      setPendingSessionId(null);
    }
    setIsSessionDirty(false);
    setIsFinanceDirty(false);
  }

  if (sessionsQuery.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 animate-pulse">
        <div className="h-16 rounded-xl border border-border bg-muted/40" />
        <div className="h-64 rounded-xl border border-border bg-muted/40" />
        <div className="h-48 rounded-xl border border-border bg-muted/40" />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Academic Sessions
          </h1>
          <p className="text-xs text-muted-foreground">
            Create academic school sessions to configure exams, grading scales, and attendance.
          </p>
        </div>

        <Empty className="border border-dashed p-10">
          <EmptyHeader>
            <EmptyTitle>No academic sessions found</EmptyTitle>
            <EmptyDescription>
              This school does not have any academic sessions yet. Create a session to get started.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              type="button"
              size="sm"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus className="size-3.5" />
              Create first session
            </Button>
          </EmptyContent>
        </Empty>

        <CreateSessionDialog
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          onSubmit={async (val) => {
            await createSessionMutation.mutateAsync(val);
          }}
          isSubmitting={createSessionMutation.isPending}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      {/* Top Toolbar: Session Switcher and Actions */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <Label htmlFor="session-switcher" className="text-xs font-medium">
            Session:
          </Label>
          <NativeSelect
            id="session-switcher"
            value={currentSession?.id ?? ''}
            onChange={(event) => handleSelectSession(event.target.value)}
          >
            {sessions.map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>
                {s.sessionStartYear}&ndash;{s.sessionEndYear}
                {s.isActive ? ' (Active)' : ''}
              </NativeSelectOption>
            ))}
          </NativeSelect>

          {currentSession?.isActive ? (
            <Badge variant="outline" className="border-emerald-500/30 text-[10px] text-emerald-600 dark:text-emerald-400">
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
          {!currentSession?.isActive ? (
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
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus className="size-3.5" />
            New session
          </Button>
        </div>
      </div>

      {/* Main Session View & Editor */}
      {currentSession && (
        <>
          <SessionDetailsView
            key={currentSession.id}
            session={currentSession as SchoolSessionDto}
            isSaving={updateSessionMutation.isPending}
            onSave={async (updates) => {
              await updateSessionMutation.mutateAsync(updates);
            }}
            onDirtyChange={setIsSessionDirty}
          />
          <SessionFinanceSettings
            key={`finance-${currentSession.id}`}
            schoolId={schoolId}
            sessionId={currentSession.id}
            isEditable={currentSession.isActive}
            onDirtyChange={setIsFinanceDirty}
          />
        </>
      )}

      {/* Unsaved Changes Confirmation Dialog */}
      <UnsavedChangesDialog
        open={Boolean(pendingSessionId)}
        onOpenChange={(open) => {
          if (!open) setPendingSessionId(null);
        }}
        onConfirmDiscard={handleConfirmDiscardNavigation}
      />

      {/* Create Session Dialog */}
      <CreateSessionDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onSubmit={async (val) => {
          await createSessionMutation.mutateAsync(val);
        }}
        isSubmitting={createSessionMutation.isPending}
      />

      {/* Delete Session Confirmation */}
      {currentSession && !currentSession.isActive ? (
        <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete session {currentSession.sessionStartYear}&ndash;{currentSession.sessionEndYear}?
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
      ) : null}
    </div>
  );
}

'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { Button } from '@campuspilot/ui/components/button';
import { Plus } from 'lucide-react';
import { client, orpc } from '@/lib/orpc';
import { RequirePermissions } from '../require-permissions';
import { CreateSessionDialog } from './create-session-dialog';

/**
 * Creates an academic session and refreshes every session list and filter.
 * When the school had no active session the server makes the new one active,
 * so every screen waiting for an active session (the school's entry page,
 * the session switcher) moves on once the lists are read again.
 */
export function useCreateSession(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (value: { sessionStartYear: number; sessionEndYear: number }) =>
      client.school.createSession({ schoolId, ...value }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.school.listSessions.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.school.listSessionFilterOptions.key() }),
      ]);
    },
  });
}

type CreateSessionButtonProps = {
  schoolId: string;
  label?: string;
  variant?: 'default' | 'outline';
  className?: string;
  /** Shown instead to people who may not create sessions (default: nothing). */
  fallback?: ReactNode;
};

/**
 * "Create a session" for the empty states of a school without sessions or
 * without an active one: a button that opens the session dialog in place,
 * shown only to people who may create sessions.
 */
export function CreateSessionButton({
  schoolId,
  label = 'Create a session',
  variant = 'default',
  className,
  fallback,
}: CreateSessionButtonProps) {
  const [open, setOpen] = useState(false);
  const createSession = useCreateSession(schoolId);
  return (
    <RequirePermissions
      permissions={{ action: SCHOOL_ACTIONS.CREATE_SESSION, resource: { kind: 'school', schoolId } }}
      fallback={fallback}
      pending={fallback}
    >
      <Button type="button" variant={variant} className={className} onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {label}
      </Button>
      <CreateSessionDialog
        open={open}
        onOpenChange={setOpen}
        onSubmit={async (value) => {
          await createSession.mutateAsync(value);
        }}
        isSubmitting={createSession.isPending}
      />
    </RequirePermissions>
  );
}

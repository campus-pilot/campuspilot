'use client';

import type { AssistantRoleState } from '@campuspilot/api/routers/school/assistant-access/assistant-access.dto';
import type { Role } from '@campuspilot/api/routers/school/member/member.dto';
import { resolveQueryBoundary } from '@campuspilot/components/query-boundary';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import { Label } from '@campuspilot/ui/components/label';
import { Switch } from '@campuspilot/ui/components/switch';
import { toast } from '@campuspilot/ui/lib/toast';
import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { z } from 'zod';

import { client, orpc } from '@/lib/orpc';

const ROLE_LABELS: Record<Role, string> = {
  principal: 'Principal',
  manager: 'Manager',
  teacher: 'Teacher',
  accountant: 'Accountant',
  exam_coordinator: 'Exam coordinator',
};

const rolesFormSchema = z.object({ enabled: z.record(z.string(), z.boolean()) });

/**
 * The switches for the school's roles. This is the school's one role list:
 * the school's principal or manager edits the very same rows in the
 * school's own settings, so what is saved here is what they see, and what
 * they save shows here. Only the changed roles are sent, so a role someone
 * else changed meanwhile is not overwritten by this form's older value.
 */
function useAssistantRolesForm(schoolId: string, roles: AssistantRoleState[]) {
  const queryClient = useQueryClient();
  const initial = Object.fromEntries(roles.map((row) => [row.role, row.enabled])) as Record<Role, boolean>;
  const form = useForm({
    defaultValues: { enabled: initial },
    validators: { onSubmit: rolesFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      const changes = roles
        .filter((row) => value.enabled[row.role] !== row.enabled)
        .map((row) => ({ role: row.role, enabled: value.enabled[row.role] }));
      if (changes.length === 0) return;
      try {
        const saved = await client.systemAdmin.updateSchoolAssistantRoles({ id: schoolId, roles: changes });
        queryClient.setQueryData(orpc.systemAdmin.getSchoolAssistantRoles.queryKey({ input: { id: schoolId } }), saved);
        toast.success('AI assistant roles saved.');
      } catch (error) {
        form.setErrorMap({ onSubmit: { form: error instanceof Error ? error.message : 'Unable to save the roles.', fields: {} } });
      }
    },
  });
  return form;
}

type AssistantRolesForm = ReturnType<typeof useAssistantRolesForm>;

function RoleSwitch({ form, role }: { form: AssistantRolesForm; role: Role }) {
  return (
    <form.Field name={`enabled.${role}`}>
      {(field) => (
        <div className="flex items-center justify-between gap-4 py-2">
          <Label htmlFor={`assistant-role-${role}`}>{ROLE_LABELS[role]}</Label>
          <Switch id={`assistant-role-${role}`} checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked)} />
        </div>
      )}
    </form.Field>
  );
}

function SaveRow({ form }: { form: AssistantRolesForm }) {
  return (
    <form.Subscribe selector={(state) => ({ isDirty: state.isDirty, isSubmitting: state.isSubmitting, errors: state.errors })}>
      {({ isDirty, isSubmitting, errors }) => (
        <div className="flex flex-col gap-2">
          {errors.map((error) => (
            <p key={String(error)} className="text-xs text-destructive">
              {typeof error === 'object' && error && 'form' in error ? String(error.form) : String(error)}
            </p>
          ))}
          <div className="flex justify-end">
            <Button type="submit" disabled={!isDirty || isSubmitting}>
              {isSubmitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              {isSubmitting ? 'Saving…' : 'Save roles'}
            </Button>
          </div>
        </div>
      )}
    </form.Subscribe>
  );
}

/** The roles form, keyed by the caller on the stored list so it restarts from what was saved (by anyone). */
function AssistantRolesForm({ schoolId, roles }: { schoolId: string; roles: AssistantRoleState[] }) {
  const form = useAssistantRolesForm(schoolId, roles);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="flex flex-col divide-y">
        {roles.map((row) => (
          <RoleSwitch key={row.role} form={form} role={row.role} />
        ))}
      </div>
      <SaveRow form={form} />
    </form>
  );
}

/** In the card's place when the role list could not be read (and none is held). */
function RolesUnavailableCard({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Unable to load the roles</CardTitle>
        <CardDescription>The school&apos;s assistant roles could not be read.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * School › AI › Roles: which of the school's roles may use the assistant.
 * One list with two editors (this card and the school's Settings › AI
 * assistant), so the two screens cannot disagree. It can be edited while
 * the assistant is off, to prepare it.
 */
export function AssistantRolesCard({ schoolId }: { schoolId: string }) {
  const rolesQuery = useQuery(orpc.systemAdmin.getSchoolAssistantRoles.queryOptions({ input: { id: schoolId } }));
  const state = resolveQueryBoundary(rolesQuery);
  if (state.kind === 'pending') return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  if (state.kind === 'failed') return <RolesUnavailableCard onRetry={() => void rolesQuery.refetch()} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles</CardTitle>
        <CardDescription>
          The roles that may use the assistant in this school. This is the same list the school&apos;s principal or
          manager edits in the school&apos;s Settings › AI assistant: a change made here shows there, and a change made
          there shows here. Enabling the assistant for a school with no role switched on switches it on for the
          principal, manager, exam coordinator and accountant.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AssistantRolesForm key={JSON.stringify(state.data.roles)} schoolId={schoolId} roles={state.data.roles} />
      </CardContent>
    </Card>
  );
}

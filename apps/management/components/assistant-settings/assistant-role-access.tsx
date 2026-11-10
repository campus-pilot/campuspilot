'use client';

import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { AssistantAccessDto } from '@campuspilot/api/routers/school/assistant-access/assistant-access.dto';
import type { Role } from '@campuspilot/api/routers/school/member/member.dto';
import { formatUsdText } from '@campuspilot/assistant-contract/money';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import { Label } from '@campuspilot/ui/components/label';
import { Switch } from '@campuspilot/ui/components/switch';
import { toast } from '@campuspilot/ui/lib/toast';
import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { RequirePermissions } from '@/components/require-permissions';
import { roleLabels } from '@/components/staff-role-picker';
import { client, orpc } from '@/lib/orpc';

import { assistantOrpc } from '@/lib/assistant-client';

const roleAccessSchema = z.object({ enabled: z.record(z.string(), z.boolean()) });

type RoleRow = AssistantAccessDto['roles'][number];

/**
 * The switches for the school's roles. Each eligible role can be switched on
 * or off; a role the school switched on that the platform no longer makes
 * eligible is shown as not available on the plan and can only be switched
 * off; other roles are listed as not available. Only the changed roles are
 * sent.
 */
function useRoleAccessForm(schoolId: string, access: AssistantAccessDto) {
  const queryClient = useQueryClient();
  const initial = Object.fromEntries(access.roles.map((row) => [row.role, row.enabled])) as Record<Role, boolean>;
  const form = useForm({
    defaultValues: { enabled: initial },
    validators: { onSubmit: roleAccessSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      const changes = access.roles
        .filter((row) => value.enabled[row.role] !== row.enabled)
        .map((row) => ({ role: row.role, enabled: value.enabled[row.role] }));
      if (changes.length === 0) return;
      try {
        const saved = await client.school.updateAssistantRoles({ schoolId, roles: changes });
        queryClient.setQueryData(orpc.school.getAssistantAccess.queryKey({ input: { schoolId } }), saved);
        // Who may use the assistant changed, including possibly the viewer.
        void queryClient.invalidateQueries({ queryKey: assistantOrpc.getStatus.key() });
        toast.success('AI assistant access saved.');
      } catch (error) {
        form.setErrorMap({ onSubmit: { form: error instanceof Error ? error.message : 'Unable to save.', fields: {} } });
      }
    },
  });
  return form;
}

type RoleAccessForm = ReturnType<typeof useRoleAccessForm>;

function RoleNote({ row }: { row: RoleRow }) {
  if (row.eligible) return null;
  return <Badge variant="outline">{row.enabled ? 'Not available on your plan' : 'Not available'}</Badge>;
}

function RoleSwitch({ form, row, canManage }: { form: RoleAccessForm; row: RoleRow; canManage: boolean }) {
  return (
    <form.Field name={`enabled.${row.role}`}>
      {(field) => {
        // Switching on needs eligibility; switching off is always possible.
        const locked = !canManage || (!row.eligible && !field.state.value);
        return (
          <div className="flex items-center justify-between gap-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor={`assistant-role-${row.role}`}>{roleLabels[row.role]}</Label>
              <RoleNote row={row} />
            </div>
            <Switch
              id={`assistant-role-${row.role}`}
              checked={field.state.value}
              disabled={locked}
              onCheckedChange={(checked) => field.handleChange(checked)}
            />
          </div>
        );
      }}
    </form.Field>
  );
}

function SaveButton({ form }: { form: RoleAccessForm }) {
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
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      )}
    </form.Subscribe>
  );
}

function RoleAccessForm({ schoolId, access, canManage }: { schoolId: string; access: AssistantAccessDto; canManage: boolean }) {
  const form = useRoleAccessForm(schoolId, access);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="flex flex-col divide-y">
        {access.roles.map((row) => (
          <RoleSwitch key={row.role} form={form} row={row} canManage={canManage} />
        ))}
      </div>
      {canManage ? <SaveButton form={form} /> : null}
    </form>
  );
}

function limitText(access: AssistantAccessDto) {
  return access.monthlyLimitUsd === null
    ? 'Your plan has no monthly limit.'
    : `Your plan allows ${formatUsdText(String(access.monthlyLimitUsd))} of assistant use per calendar month; once it is reached the assistant is unavailable until the 1st.`;
}

/**
 * Settings › AI assistant: which of the school's roles may use the in-app
 * assistant. The principal and manager decide, among the roles the plan
 * makes eligible. Every tool call is still checked against the person's own
 * permissions; this only decides who may ask.
 */
export function AssistantRoleAccess({ schoolId }: { schoolId: string }) {
  const query = useQuery(orpc.school.getAssistantAccess.queryOptions({ input: { schoolId } }));
  return (
    <Card className="mx-auto w-full max-w-3xl">
      <CardHeader>
        <CardTitle>AI assistant</CardTitle>
        <CardDescription>
          Choose which roles can use the assistant. It acts with each person’s own permissions.
          {query.data ? ` ${limitText(query.data)}` : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        ) : query.isError ? (
          <p className="text-sm text-destructive">{query.error.message}</p>
        ) : (
          <RequirePermissions
            permissions={{ action: SCHOOL_ACTIONS.MANAGE_ASSISTANT_ACCESS, resource: { kind: 'school', schoolId } }}
            fallback={<RoleAccessForm key="read" schoolId={schoolId} access={query.data} canManage={false} />}
          >
            <RoleAccessForm key={JSON.stringify(query.data.roles)} schoolId={schoolId} access={query.data} canManage />
          </RequirePermissions>
        )}
      </CardContent>
    </Card>
  );
}

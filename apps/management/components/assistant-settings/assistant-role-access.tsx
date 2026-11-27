'use client';

import { BILLING_PERIOD_DAYS } from '@campuspilot/api/billing/billing.contract';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { AssistantAccessDto } from '@campuspilot/api/routers/school/assistant-access/assistant-access.dto';
import type { Role } from '@campuspilot/api/routers/school/member/member.dto';
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

import { AssistantAllowanceSummary } from './assistant-allowance';

const roleAccessSchema = z.object({ enabled: z.record(z.string(), z.boolean()) });

type RoleRow = AssistantAccessDto['roles'][number];

/**
 * The switches for the school's roles: the assistant is on or off for each,
 * and any role can be switched either way. It is the school's one list,
 * which CampusPilot's administrators edit too, so the form starts from
 * whatever was saved last by either. Only the changed roles are sent.
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

function RoleSwitch({ form, row, canManage }: { form: RoleAccessForm; row: RoleRow; canManage: boolean }) {
  return (
    <form.Field name={`enabled.${row.role}`}>
      {(field) => (
        <div className="flex items-center justify-between gap-4 py-2">
          <Label htmlFor={`assistant-role-${row.role}`}>{roleLabels[row.role]}</Label>
          <Switch
            id={`assistant-role-${row.role}`}
            checked={field.state.value}
            disabled={!canManage}
            onCheckedChange={(checked) => field.handleChange(checked)}
          />
        </div>
      )}
    </form.Field>
  );
}

function SaveButton({ form }: { form: RoleAccessForm }) {
  return (
    <form.Subscribe selector={(state) => ({ isDirty: state.isDirty, isSubmitting: state.isSubmitting, errors: state.errors })}>
      {({ isDirty, isSubmitting, errors }) => (
        <div className="flex flex-col gap-2">
          {errors.map((error) => (
            <p key={String(error)} role="alert" className="text-xs text-destructive">
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

/** What the plan allows, without an amount: schools see their use only as a share of the allowance. */
function limitText(access: AssistantAccessDto) {
  return access.limited
    ? `Your plan includes an AI allowance for every ${BILLING_PERIOD_DAYS} days of a billing period, or every calendar month without one. Once 100% is used, the assistant is unavailable until it resets.`
    : 'Your plan has no AI usage limit.';
}

/** The allowance meter for those who may read the school's usage (the principal and manager); nothing without a limit. */
function AllowanceMeterForReaders({ schoolId, access }: { schoolId: string; access: AssistantAccessDto }) {
  if (!access.limited) return null;
  return (
    <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.READ_ASSISTANT_USAGE, resource: { kind: 'school', schoolId } }}>
      <AssistantAllowanceSummary schoolId={schoolId} />
    </RequirePermissions>
  );
}

/**
 * Settings › AI assistant: which of the school's roles may use the in-app
 * assistant. The principal and manager decide, for every role; CampusPilot's
 * administrators can change the same list from the admin app, and each side
 * sees what the other saved. Every tool call is still checked against the
 * person's own permissions; this only decides who may ask.
 */
export function AssistantRoleAccess({ schoolId }: { schoolId: string }) {
  const query = useQuery(orpc.school.getAssistantAccess.queryOptions({ input: { schoolId } }));
  return (
    <Card className="mx-auto w-full max-w-3xl">
      <CardHeader>
        <CardTitle>AI assistant</CardTitle>
        <CardDescription>
          Choose which roles can use the assistant. It acts with each person’s own permissions. This is your school’s list;
          CampusPilot support can change it too.
          {query.data ? ` ${limitText(query.data)}` : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {query.data ? <AllowanceMeterForReaders schoolId={schoolId} access={query.data} /> : null}
        {query.isPending ? (
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        ) : query.isError ? (
          <p className="text-sm text-destructive">{query.error.message}</p>
        ) : (
          <RequirePermissions
            permissions={{ action: SCHOOL_ACTIONS.MANAGE_ASSISTANT_ACCESS, resource: { kind: 'school', schoolId } }}
            fallback={<RoleAccessForm key="read" schoolId={schoolId} access={query.data} canManage={false} />}
            pending={<RoleAccessForm key="read" schoolId={schoolId} access={query.data} canManage={false} />}
          >
            <RoleAccessForm key={JSON.stringify(query.data.roles)} schoolId={schoolId} access={query.data} canManage />
          </RequirePermissions>
        )}
      </CardContent>
    </Card>
  );
}

'use client';

import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { SchoolDto } from '@campuspilot/api/routers/system-admin/school/school.dto';
import { staffSignInLabel } from '@campuspilot/components/staff-account/staff-sign-in-label';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import { Label } from '@campuspilot/ui/components/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@campuspilot/ui/components/select';
import { toast } from '@campuspilot/ui/lib/toast';
import { LoaderCircle } from 'lucide-react';
import { client, orpc } from '@/lib/orpc';

/** The Select's value for "no owner": Radix Select items cannot have an empty value. */
const NO_OWNER = 'none';

const ownerFormSchema = z.object({ owner: z.string().min(1) });

/** The school's principals, the only members who can own it (the server checks the same). */
function usePrincipals(schoolId: string) {
  return useQuery(
    orpc.school.listMembers.queryOptions({
      input: { schoolId, limit: 20, filters: { role: 'principal' } },
    }),
  );
}

function useOwnerForm(school: SchoolDto) {
  const queryClient = useQueryClient();
  return useForm({
    defaultValues: { owner: school.ownerUserId ?? NO_OWNER },
    validators: { onSubmit: ownerFormSchema },
    onSubmit: async ({ value, formApi }) => {
      formApi.setErrorMap({});
      try {
        const updated = await client.systemAdmin.updateSchoolOwner({
          id: school.id,
          ownerUserId: value.owner === NO_OWNER ? null : value.owner,
        });
        queryClient.setQueryData(orpc.systemAdmin.getSchool.queryKey({ input: { id: school.id } }), updated);
        void queryClient.invalidateQueries({ queryKey: orpc.school.listMembers.key() });
        toast.success(updated.ownerUserId ? 'Owner changed.' : 'The school has no owner now.');
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: { form: error instanceof Error ? error.message : 'Unable to change the owner.', fields: {} },
        });
      }
    },
  });
}

function OwnerForm({ school }: { school: SchoolDto }) {
  const principals = usePrincipals(school.id);
  const form = useOwnerForm(school);
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field name="owner">
        {(field) => (
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="school-owner">Owner</Label>
            <Select value={field.state.value} onValueChange={field.handleChange}>
              <SelectTrigger id="school-owner" className="w-full">
                <SelectValue placeholder={principals.isPending ? 'Loading principals…' : 'Choose a principal'} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={NO_OWNER}>No owner</SelectItem>
                  {(principals.data?.items ?? []).map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {member.name.trim() || staffSignInLabel(member)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => ({ isSubmitting: state.isSubmitting, isDirty: state.isDirty })}>
        {({ isSubmitting, isDirty }) => (
          <Button type="submit" disabled={!isDirty || isSubmitting}>
            {isSubmitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            Save owner
          </Button>
        )}
      </form.Subscribe>
      <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
        {(error) =>
          error && typeof error === 'object' && 'form' in error ? (
            <p className="text-xs text-destructive sm:basis-full">{String(error.form)}</p>
          ) : null
        }
      </form.Subscribe>
    </form>
  );
}

/**
 * The school's owner (docs/school-creation.md): the person accountable for
 * it, who cannot be removed or lose the principal role in the school. Only a
 * principal can be named. Changing the owner does not change anyone's
 * school creation allowance: the creator's creation still counts.
 */
export function SchoolOwnerCard({ school }: { school: SchoolDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Owner</CardTitle>
        <CardDescription>
          The owner cannot be removed from the school or lose the principal role. Transfer ownership here when
          a school changes hands; to make someone owner, make them a principal first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <OwnerForm key={school.ownerUserId ?? NO_OWNER} school={school} />
      </CardContent>
    </Card>
  );
}

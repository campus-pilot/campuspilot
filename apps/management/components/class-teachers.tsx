'use client';

import { useState } from 'react';
import type { SchoolMemberDto } from '@campuspilot/api/routers/school/member/member.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar, AvatarFallback, AvatarImage } from '@campuspilot/ui/components/avatar';
import { Button } from '@campuspilot/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import { Label } from '@campuspilot/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@campuspilot/ui/components/radio-group';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@campuspilot/ui/components/table';
import { Plus, UserMinus } from 'lucide-react';
import { z } from 'zod';
import { client, orpc } from '@/lib/orpc';
import { FormErrors } from './form-errors';
import { RequirePermissions } from './require-permissions';

const teacherSelectionSchema = z.object({ userId: z.string().min(1, 'Select a teacher') });

function memberName(member: SchoolMemberDto) {
  return member.name.trim() || member.email;
}

function initials(member: SchoolMemberDto) {
  return memberName(member)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function withClassAssignment(member: SchoolMemberDto, classId: string, assigned: boolean) {
  return member.roles.map((assignment) => {
    if (assignment.role !== 'teacher') return assignment;
    const current = assignment.meta?.classIds ?? [];
    const classIds = assigned
      ? Array.from(new Set([...current, classId]))
      : current.filter((id) => id !== classId);
    return { ...assignment, meta: { ...assignment.meta, classIds } };
  });
}

function AddTeacherDialog({ classId, schoolId, onClose }: { classId: string; schoolId: string; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const candidatesQuery = useQuery(
    orpc.school.listMembers.queryOptions({
      input: {
        schoolId,
        page,
        limit: 20,
        filters: { role: 'teacher', excludeClassId: classId },
        orderBy: { field: 'name', direction: 'asc' },
      },
    }),
  );
  const form = useForm({
    defaultValues: { userId: '' },
    validators: { onSubmit: teacherSelectionSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      const member = candidatesQuery.data?.items.find(({ userId }) => userId === value.userId);
      if (!member) {
        form.setErrorMap({ onSubmit: { form: 'Select a teacher from the current page.', fields: {} } });
        return;
      }
      try {
        await client.school.updateMemberRoles({
          schoolId,
          userId: member.userId,
          roles: withClassAssignment(member, classId, true),
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.school.listMembers.queryKey({ input: { schoolId } }) }),
          queryClient.invalidateQueries({ queryKey: orpc.school.listClasses.queryKey({ input: { schoolId } }) }),
        ]);
        onClose();
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            form: error instanceof Error ? error.message : 'Unable to assign this teacher.',
            fields: {},
          },
        });
      }
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add teacher</DialogTitle>
          <DialogDescription>Select a school teacher who is not already assigned to this classroom.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="userId">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label>Teacher</Label>
                {candidatesQuery.isPending ? <Skeleton className="h-36 w-full" /> : null}
                {candidatesQuery.data?.items.length === 0 ? (
                  <p className="rounded-lg border p-4 text-sm text-muted-foreground">No unassigned teachers found.</p>
                ) : null}
                <RadioGroup value={field.state.value} onValueChange={field.handleChange} className="max-h-72 overflow-y-auto rounded-lg border p-2">
                  {candidatesQuery.data?.items.map((member) => (
                    <Label key={member.userId} className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted">
                      <RadioGroupItem value={member.userId} />
                      <Avatar>
                        {member.profileImageUrl ? <AvatarImage src={member.profileImageUrl} alt="" /> : null}
                        <AvatarFallback>{initials(member)}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{memberName(member)}</span>
                        <span className="block truncate text-muted-foreground">{member.email}</span>
                      </span>
                    </Label>
                  ))}
                </RadioGroup>
                <FormErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          {candidatesQuery.data && candidatesQuery.data.pagination.totalPages > 1 ? (
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>Page {page} of {candidatesQuery.data.pagination.totalPages}</span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={page === 1} onClick={() => { setPage((current) => current - 1); form.setFieldValue('userId', ''); }}>Previous</Button>
                <Button type="button" variant="outline" size="sm" disabled={page === candidatesQuery.data.pagination.totalPages} onClick={() => { setPage((current) => current + 1); form.setFieldValue('userId', ''); }}>Next</Button>
              </div>
            </div>
          ) : null}
          <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, errors: state.errors, isSubmitting: state.isSubmitting })}>
            {({ canSubmit, errors, isSubmitting }) => (
              <>
                <FormErrors errors={errors} />
                <DialogFooter>
                  <Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>Cancel</Button>
                  <Button type="submit" disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Adding…' : 'Add teacher'}</Button>
                </DialogFooter>
              </>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ClassTeachers({ classId, schoolId }: { classId: string; schoolId: string }) {
  const [addOpen, setAddOpen] = useState(false);
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const teachersQuery = useQuery(
    orpc.school.listMembers.queryOptions({
      input: {
        schoolId,
        page,
        limit: 20,
        filters: { role: 'teacher', classId },
        orderBy: { field: 'name', direction: 'asc' },
      },
    }),
  );
  const removeMutation = useMutation({
    mutationFn: (member: SchoolMemberDto) =>
      client.school.updateMemberRoles({ schoolId, userId: member.userId, roles: withClassAssignment(member, classId, false) }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.school.listMembers.queryKey({ input: { schoolId } }) }),
        queryClient.invalidateQueries({ queryKey: orpc.school.listClasses.queryKey({ input: { schoolId } }) }),
      ]);
    },
  });

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Teachers</h2>
          <p className="text-sm text-muted-foreground">Staff assigned to teach this classroom.</p>
        </div>
        <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.UPDATE_MEMBER_ROLES, resource: { kind: 'school', schoolId } }}>
          <Button type="button" onClick={() => setAddOpen(true)}><Plus aria-hidden /> Add teacher</Button>
        </RequirePermissions>
      </div>
      {teachersQuery.isPending ? <Skeleton className="h-64 w-full rounded-xl" /> : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table aria-label="Class teachers">
            <TableHeader className="bg-muted/40"><TableRow><TableHead>Teacher</TableHead><TableHead>Email</TableHead><TableHead className="w-20"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {teachersQuery.data?.items.length ? teachersQuery.data.items.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell><div className="flex items-center gap-3"><Avatar>{member.profileImageUrl ? <AvatarImage src={member.profileImageUrl} alt="" /> : null}<AvatarFallback>{initials(member)}</AvatarFallback></Avatar><span className="font-medium">{memberName(member)}</span></div></TableCell>
                  <TableCell className="text-muted-foreground">{member.email}</TableCell>
                  <TableCell className="text-right">
                    <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.UPDATE_MEMBER_ROLES, resource: { kind: 'school', schoolId } }}>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${memberName(member)} from class`} disabled={removeMutation.isPending} onClick={() => removeMutation.mutate(member)}><UserMinus aria-hidden /></Button>
                    </RequirePermissions>
                  </TableCell>
                </TableRow>
              )) : <TableRow><TableCell colSpan={3} className="h-32 text-center text-muted-foreground">No teachers are assigned yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      )}
      {removeMutation.error ? <p className="text-xs text-destructive">{removeMutation.error instanceof Error ? removeMutation.error.message : 'Unable to remove this teacher.'}</p> : null}
      {teachersQuery.data && teachersQuery.data.pagination.totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2"><Button type="button" variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><span className="text-xs text-muted-foreground">Page {page} of {teachersQuery.data.pagination.totalPages}</span><Button type="button" variant="outline" size="sm" disabled={page === teachersQuery.data.pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button></div>
      ) : null}
      {addOpen ? <AddTeacherDialog classId={classId} schoolId={schoolId} onClose={() => setAddOpen(false)} /> : null}
    </section>
  );
}

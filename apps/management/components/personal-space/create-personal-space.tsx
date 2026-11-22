'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NotebookPen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@campuspilot/ui/components/button';
import { requestErrorMessage } from '@/components/question-paper/question-paper-model';
import { storeSchoolId } from '@/components/school-selection';
import { orpc } from '@/lib/orpc';
import { personalPapersHref } from './personal-space-model';

/**
 * The way to a personal space from the "not part of a school yet" page
 * (docs/personal-space.md): offered only while the server says this person
 * may create one (`personalSpace.getStatus`, refusal null: a linked Google
 * account, no school at all, not a demo login, none yet). Creating it opens
 * its papers. Shown beside the school creation panel; nothing while the
 * answer loads or when it is refused.
 */
export function CreatePersonalSpace() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useQuery(orpc.personalSpace.getStatus.queryOptions());
  const create = useMutation(
    orpc.personalSpace.create.mutationOptions({
      onSuccess: async ({ schoolId }) => {
        await queryClient.invalidateQueries({ queryKey: orpc.school.listMySchools.key() });
        storeSchoolId(schoolId);
        router.push(personalPapersHref(schoolId));
      },
    }),
  );
  if (status.data?.refusal !== null) return null;
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-xl border bg-card p-5 text-center">
      <span className="grid size-10 place-items-center rounded-xl bg-muted">
        <NotebookPen className="size-5" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Just need question papers?</h2>
        <p className="text-sm text-muted-foreground">
          Create a personal space and turn photos of a handwritten paper into a printed one, on a free trial. No school setup needed.
        </p>
      </div>
      <Button type="button" variant="outline" disabled={create.isPending} onClick={() => create.mutate({})}>
        {create.isPending ? 'Creating…' : 'Create personal space'}
      </Button>
      {create.error ? (
        <p role="alert" className="text-sm text-destructive">
          {requestErrorMessage(create.error, 'Your personal space could not be created.')}
        </p>
      ) : null}
    </div>
  );
}

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
 * Whether this person may create their personal space now and the creation
 * itself (docs/personal-space.md), shared by the "not part of a school yet"
 * page and the school switcher. Offered only while the server says so
 * (`personalSpace.getStatus`, refusal null: a linked Google account, not a
 * demo login, none ever; belonging to a school does not matter), so
 * `mayCreate` is false while the answer loads or when it is refused.
 * Creating it opens its papers. `onCreated` runs before the navigation, for
 * a caller that closes its own surface.
 */
export function useCreatePersonalSpace({ onCreated }: { onCreated?: () => void } = {}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useQuery(orpc.personalSpace.getStatus.queryOptions());
  const create = useMutation(
    orpc.personalSpace.create.mutationOptions({
      onSuccess: async ({ schoolId }) => {
        // `all`: the cached list is read again whether or not a screen shows it, so the space's access check finds it.
        await queryClient.invalidateQueries({ queryKey: orpc.school.listMySchools.key(), refetchType: 'all' });
        // The status now refuses (`already_has_one`), so no surface keeps offering a second space.
        await queryClient.invalidateQueries({ queryKey: orpc.personalSpace.getStatus.key() });
        storeSchoolId(schoolId);
        onCreated?.();
        router.push(personalPapersHref(schoolId));
      },
    }),
  );
  return { mayCreate: status.data?.refusal === null, create };
}

/**
 * The way to a personal space from the "not part of a school yet" page,
 * shown beside the school creation panel while {@link useCreatePersonalSpace}
 * offers one; nothing otherwise.
 */
export function CreatePersonalSpace() {
  const { mayCreate, create } = useCreatePersonalSpace();
  if (!mayCreate) return null;
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

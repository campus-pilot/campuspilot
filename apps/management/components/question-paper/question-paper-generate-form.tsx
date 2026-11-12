'use client';

import { useMutation } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Button } from '@campuspilot/ui/components/button';
import { toast } from '@campuspilot/ui/lib/toast';
import { AiBadge } from '@campuspilot/components/question-paper/ai-badge';
import { generateBlockedReason } from '@campuspilot/components/question-paper/question-paper-model';
import { orpc } from '@/lib/orpc';
import { isConflict, requestErrorMessage, type QuestionPaperScope } from './question-paper-model';
import { useRefreshQuestionPaper } from './use-question-paper-detail';

const generateSchema = z.object({ expectedPageRevision: z.number().int().min(0) });

/**
 * "Generate with AI". The page revision the user saw travels with the request,
 * so photos added or reordered elsewhere in the meantime are refused (CONFLICT)
 * instead of being silently left out. The revision is the form's default value,
 * so the parent re-keys this form on it (a keyed lifecycle: a new revision is a
 * new form, no effect needed).
 *
 * Submit availability comes from `form.Subscribe`; the reason a closed button
 * is closed is always written next to it.
 */
export function QuestionPaperGenerateForm({
  scope,
  expectedPageRevision,
  pageCount,
  templateConfigured,
  blockedReason,
}: {
  scope: QuestionPaperScope;
  expectedPageRevision: number;
  pageCount: number;
  templateConfigured: boolean;
  /** Why changing the paper is closed (exam ended, no permission, job running), or null. */
  blockedReason: string | null;
}) {
  const refresh = useRefreshQuestionPaper(scope);
  const start = useMutation(orpc.school.startQuestionPaperGeneration.mutationOptions());
  const form = useForm({
    defaultValues: { expectedPageRevision },
    validators: { onChange: generateSchema, onSubmit: generateSchema },
    onSubmit: async ({ value }) => {
      try {
        await start.mutateAsync({ ...scope, expectedPageRevision: value.expectedPageRevision });
      } catch (error) {
        // A conflict re-keys this form (new revision), which would drop an inline message, so it is a toast.
        if (isConflict(error)) toast.error('The pages changed since you opened them. They were reloaded; check them and try again.');
        // Any other failure is shown beside the button from `start.error`.
      }
      // Success starts polling (an active job); a conflict reloads what changed.
      await refresh();
    },
  });
  const reason = generateBlockedReason({ pageCount, templateConfigured, blockedReason });
  const failure = start.error && !isConflict(start.error) ? requestErrorMessage(start.error, 'The generation could not be started.') : null;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={reason !== null || !canSubmit || isSubmitting}>
              {isSubmitting ? 'Starting…' : 'Generate with AI'}
              <AiBadge onPrimary />
            </Button>
          )}
        </form.Subscribe>
        {reason ? <p className="text-xs text-muted-foreground">{reason}</p> : null}
      </div>
      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}
    </form>
  );
}

import { ASSISTANT_MESSAGE_MAX_LENGTH } from '@campuspilot/assistant-contract/dto';
import { Button } from '@campuspilot/ui/components/button';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { Textarea } from '@campuspilot/ui/components/textarea';
import { useForm } from '@tanstack/react-form';
import { ArrowUp, Square } from 'lucide-react';
import { z } from 'zod';

const composerSchema = z.object({
  text: z
    .string()
    .max(ASSISTANT_MESSAGE_MAX_LENGTH, `Keep messages under ${ASSISTANT_MESSAGE_MAX_LENGTH} characters.`)
    .refine((text) => text.trim().length > 0, 'Write a message.'),
});

export type AssistantComposerProps = {
  /** Sends a message; a rejection keeps the draft and shows the error. */
  onSend: (text: string) => Promise<void>;
  /** Present while a run is working; the send button becomes Stop. */
  onStop?: () => void;
  stopping?: boolean;
  /** Why sending is unavailable, when it is. */
  disabledReason?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
};

function errorText(errors: unknown[]): string | null {
  const messages = errors
    .map((error) => (typeof error === 'string' ? error : (error as { message?: string } | undefined)?.message))
    .filter(Boolean);
  return messages.length ? messages.join(', ') : null;
}

/**
 * Message box. Enter sends, Shift+Enter adds a line. Messages sent while the
 * assistant works are queued behind the current run by the service.
 */
export function AssistantComposer({
  onSend,
  onStop,
  stopping = false,
  disabledReason,
  placeholder = 'Ask the assistant…',
  autoFocus = false,
}: AssistantComposerProps) {
  const form = useForm({
    defaultValues: { text: '' },
    validators: { onSubmit: composerSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await onSend(value.text.trim());
        formApi.reset();
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            form: error instanceof Error ? error.message : 'The message could not be sent.',
            fields: {},
          },
        });
      }
    },
  });
  const disabled = Boolean(disabledReason);

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="flex items-end gap-2 rounded-lg border bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring/30">
        <form.Field name="text">
          {(field) => (
            <Textarea
              aria-label="Message"
              autoFocus={autoFocus}
              disabled={disabled}
              rows={1}
              maxLength={ASSISTANT_MESSAGE_MAX_LENGTH}
              placeholder={disabledReason ?? placeholder}
              className="max-h-40 min-h-0 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void form.handleSubmit();
                }
              }}
            />
          )}
        </form.Field>
        {onStop ? (
          <Button type="button" size="icon" variant="secondary" aria-label="Stop" disabled={stopping} onClick={onStop}>
            {stopping ? <Spinner /> : <Square className="fill-current" />}
          </Button>
        ) : null}
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" size="icon" aria-label="Send" disabled={disabled || !canSubmit || isSubmitting}>
              {isSubmitting ? <Spinner /> : <ArrowUp />}
            </Button>
          )}
        </form.Subscribe>
      </div>
      <form.Subscribe selector={(state) => [state.errors, state.fieldMeta.text?.errors ?? []] as const}>
        {([formErrors, fieldErrors]) => {
          const message = errorText([...fieldErrors, ...formErrors]);
          return message ? (
            <p role="alert" className="px-1 text-xs text-destructive">
              {message}
            </p>
          ) : null;
        }}
      </form.Subscribe>
    </form>
  );
}

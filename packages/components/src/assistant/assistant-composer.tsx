import { ASSISTANT_MESSAGE_MAX_LENGTH } from '@campuspilot/assistant-contract/dto';
import { InputGroupTextarea } from '@campuspilot/ui/components/input-group';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { cn } from '@campuspilot/ui/lib/utils';
import { useForm } from '@tanstack/react-form';
import { ArrowUp, ListPlus } from 'lucide-react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { z } from 'zod';

const composerSchema = z.object({
  text: z
    .string()
    .max(ASSISTANT_MESSAGE_MAX_LENGTH, `Keep messages under ${ASSISTANT_MESSAGE_MAX_LENGTH} characters.`),
});

/** Buttons never take focus from the message box when clicked (T3 Code). */
const keepComposerFocus = (event: PointerEvent) => event.preventDefault();

/**
 * A press on the input row's padding focuses the message box instead of
 * blurring it, so the whole row behaves like the field.
 */
function focusPromptFromPadding(event: PointerEvent<HTMLDivElement>) {
  const target = event.target as Element;
  if (target.closest('textarea, button, a')) return;
  event.preventDefault();
  event.currentTarget.querySelector('textarea')?.focus();
}

const actionClassName =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none [&_svg]:pointer-events-none';

/**
 * Send, queue or stop: the composer's one coloured element. It is quiet
 * (muted) while there is nothing to send and takes the app's primary colour
 * the moment there is, so the box says when Enter will do something.
 */
function PrimaryAction({
  mode,
  ready,
  busy,
  stopping,
  onStop,
}: {
  mode: 'send' | 'queue' | 'stop';
  /** Whether there is something to send. */
  ready: boolean;
  busy: boolean;
  stopping: boolean;
  onStop?: () => void;
}) {
  if (mode === 'stop') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Stop"
            disabled={stopping}
            onPointerDown={keepComposerFocus}
            onClick={onStop}
            className={cn(actionClassName, 'w-8 bg-muted text-foreground hover:bg-muted/70 disabled:opacity-60')}
          >
            {stopping ? <Spinner className="size-3.5" /> : <span className="size-2.5 rounded-[2px] bg-destructive" aria-hidden />}
          </button>
        </TooltipTrigger>
        <TooltipContent>Stop</TooltipContent>
      </Tooltip>
    );
  }
  const label = busy ? 'Sending message' : mode === 'queue' ? 'Queue message' : 'Send message';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* aria-disabled rather than disabled, so the tooltip still explains an empty box. */}
        <button
          type="submit"
          aria-label={label}
          aria-disabled={!ready || busy}
          onPointerDown={keepComposerFocus}
          onClick={(event) => {
            if (!ready || busy) event.preventDefault();
          }}
          className={cn(
            actionClassName,
            mode === 'queue' ? 'ps-2 pe-2.5' : 'w-8',
            ready && !busy
              ? 'cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90'
              : 'cursor-default bg-muted text-muted-foreground',
          )}
        >
          {busy ? (
            <Spinner className="size-3.5" />
          ) : mode === 'queue' ? (
            <>
              <ListPlus className="size-3.5" aria-hidden />
              Queue
            </>
          ) : (
            <ArrowUp className="size-4" strokeWidth={2.25} aria-hidden />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {mode === 'queue' ? 'Queue: sends when the assistant is done' : ready ? 'Send' : 'Type a message to send'}
      </TooltipContent>
    </Tooltip>
  );
}

export type AssistantComposerProps = {
  /**
   * Sends a message. The box clears at once (the message shows optimistically
   * elsewhere); a rejection puts the text back and shows the error.
   */
  onSend: (text: string) => Promise<void>;
  /** Present while a run is working; an empty box then shows Stop, a typed one Queue. */
  onStop?: () => void;
  stopping?: boolean;
  /** Why sending is unavailable, when it is. */
  disabledReason?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
  /** Up arrow in an empty box recalls this (the last message sent). */
  lastSentText?: string;
  /**
   * Sections at the top of the box, above the message field: a change
   * waiting for approval, queued messages. Each is divided by one rule.
   */
  requests?: ReactNode;
  /** A quiet line under the box, e.g. the trust cue. */
  caption?: ReactNode;
};

function errorText(errors: unknown[]): string | null {
  const messages = errors
    .map((error) => (typeof error === 'string' ? error : (error as { message?: string } | undefined)?.message))
    .filter(Boolean);
  return messages.length ? messages.join(', ') : null;
}

/**
 * The message box: one bordered surface, painted and focused like the app's
 * inputs, so nothing is a box inside a box. Requests (approval, queue) are
 * sections of the same surface above the field; nested content uses fills,
 * never a second border. The 48px field row grows to eight lines with the
 * send control on its last line, and a caption sits outside, under it.
 */
export function AssistantComposer({
  onSend,
  onStop,
  stopping = false,
  disabledReason,
  placeholder = 'Ask about students, classes, exams…',
  autoFocus = false,
  lastSentText,
  requests,
  caption,
}: AssistantComposerProps) {
  const form = useForm({
    defaultValues: { text: '' },
    validators: { onSubmit: composerSchema },
    onSubmit: async ({ value, formApi }) => {
      const text = value.text.trim();
      if (!text) return;
      formApi.reset();
      try {
        await onSend(text);
      } catch (error) {
        formApi.setFieldValue('text', text);
        formApi.setErrorMap({
          onSubmit: { form: error instanceof Error ? error.message : 'The message could not be sent.', fields: {} },
        });
      }
    },
  });
  const disabled = Boolean(disabledReason);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, value: string) => {
    // IME composition (and Safari's keyCode 229) must never send half a word.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      if (!event.repeat) void form.handleSubmit();
      return;
    }
    if (event.key === 'ArrowUp' && !value && lastSentText) {
      event.preventDefault();
      form.setFieldValue('text', lastSentText);
    }
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div
        className={cn(
          'flex min-w-0 flex-col overflow-hidden rounded-xl border border-input bg-card transition-[border-color,box-shadow] duration-150 dark:bg-input/30',
          // A docked composer floats over the conversation: one soft shadow in light, none in dark.
          'shadow-[0_10px_24px_-18px_rgb(0_0_0/0.35)] dark:shadow-none',
          // The app's input focus colour on the border only: the box is focused nearly
          // all the time, so a halo would read as a second outline.
          'has-[textarea:focus-visible]:border-ring/70',
          disabled && 'opacity-70',
        )}
      >
        {requests ? <div className="flex min-w-0 flex-col divide-y divide-border border-b border-border">{requests}</div> : null}
        <div className="flex min-h-12 cursor-text items-end gap-2 py-2 ps-3.5 pe-2" onPointerDown={focusPromptFromPadding}>
          <form.Field name="text">
            {(field) => (
              <InputGroupTextarea
                aria-label="Message the assistant"
                autoFocus={autoFocus}
                disabled={disabled}
                rows={1}
                maxLength={ASSISTANT_MESSAGE_MAX_LENGTH}
                placeholder={disabledReason ?? placeholder}
                className="max-h-42 min-h-8 px-0 py-1.5 text-base/5 text-foreground placeholder:text-muted-foreground sm:text-sm/5 md:text-sm/5"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                onKeyDown={(event) => handleKeyDown(event, field.state.value)}
              />
            )}
          </form.Field>
          <form.Subscribe selector={(state) => [state.values.text.trim().length > 0, state.isSubmitting] as const}>
            {([hasText, isSubmitting]) => (
              <PrimaryAction
                mode={onStop ? (hasText ? 'queue' : 'stop') : 'send'}
                ready={!disabled && hasText}
                busy={isSubmitting}
                stopping={stopping}
                onStop={onStop}
              />
            )}
          </form.Subscribe>
        </div>
      </div>
      <form.Subscribe selector={(state) => [state.errors, state.fieldMeta.text?.errors ?? []] as const}>
        {([formErrors, fieldErrors]) => {
          const message = errorText([...fieldErrors, ...formErrors]);
          return message ? (
            <p role="alert" className="px-3.5 text-xs text-destructive">
              {message}
            </p>
          ) : caption ? (
            <div className="flex min-w-0 items-center gap-1.5 px-3.5 text-xs text-assistant-dim">{caption}</div>
          ) : null;
        }}
      </form.Subscribe>
    </form>
  );
}

/**
 * Messages waiting behind the working run, as compact rows at the top of
 * the composer (T3 Code moved its queue out of the timeline: they have not
 * been answered yet, so they do not belong in the conversation).
 */
export function AssistantQueuedMessages({
  messages,
}: {
  /** `status` replaces the "Queued" label, e.g. while a message is still on its way. */
  messages: readonly { id: string; text: string; status?: ReactNode }[];
}) {
  if (messages.length === 0) return null;
  return (
    <ul aria-label="Queued messages" className="flex min-w-0 flex-col px-2 py-1.5 text-xs">
      {messages.map((message) => (
        <li key={message.id} className="flex min-h-7 min-w-0 items-center gap-2 px-1.5 text-assistant-dim">
          <ListPlus className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{message.text}</span>
          <span className="shrink-0">{message.status ?? 'Queued'}</span>
        </li>
      ))}
    </ul>
  );
}

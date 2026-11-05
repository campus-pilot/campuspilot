import { ASSISTANT_MESSAGE_MAX_LENGTH } from '@campuspilot/assistant-contract/dto';
import { InputGroup, InputGroupAddon, InputGroupTextarea } from '@campuspilot/ui/components/input-group';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { cn } from '@campuspilot/ui/lib/utils';
import { useForm } from '@tanstack/react-form';
import { ListPlus } from 'lucide-react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { z } from 'zod';

const composerSchema = z.object({
  text: z
    .string()
    .max(ASSISTANT_MESSAGE_MAX_LENGTH, `Keep messages under ${ASSISTANT_MESSAGE_MAX_LENGTH} characters.`),
});

/** Buttons never take focus from the message box when clicked (T3 Code). */
const keepComposerFocus = (event: PointerEvent) => event.preventDefault();

const roundButtonClassName =
  'relative isolate flex size-9 shrink-0 items-center justify-center rounded-full shadow-xs transition-[scale,background-color,box-shadow] duration-150 enabled:cursor-pointer active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none sm:size-8 [&_svg]:pointer-events-none';

/** The send arrow, drawn at 14px with a 1.8 stroke so it reads crisply at this size. */
function SendGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopButton({ onStop, stopping }: { onStop: () => void; stopping: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Stop"
          disabled={stopping}
          onPointerDown={keepComposerFocus}
          onClick={onStop}
          className={cn(
            roundButtonClassName,
            'bg-destructive/90 text-white shadow-destructive/25 inset-shadow-control-highlight enabled:hover:bg-destructive active:inset-shadow-control-pressed disabled:opacity-60',
          )}
        >
          {stopping ? (
            <Spinner className="size-3.5" />
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <rect x="2" y="2" width="8" height="8" rx="1.5" />
            </svg>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>Stop</TooltipContent>
    </Tooltip>
  );
}

function SendButton({ disabled, busy, queue }: { disabled: boolean; busy: boolean; queue: boolean }) {
  const label = busy ? 'Sending message' : queue ? 'Queue message' : 'Send message';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="submit"
          aria-label={label}
          disabled={disabled || busy}
          onPointerDown={keepComposerFocus}
          className={cn(
            roundButtonClassName,
            'bg-primary text-primary-foreground shadow-primary/25 inset-shadow-control-highlight enabled:hover:scale-105 enabled:hover:bg-primary/90 active:inset-shadow-control-pressed disabled:bg-foreground/12 disabled:text-muted-foreground disabled:shadow-none disabled:inset-shadow-none',
          )}
        >
          {busy ? <Spinner className="size-3.5" /> : queue ? <ListPlus className="size-4" /> : <SendGlyph />}
        </button>
      </TooltipTrigger>
      <TooltipContent>{queue ? 'Queue — sends when the assistant is done' : 'Send'}</TooltipContent>
    </Tooltip>
  );
}

export type AssistantComposerProps = {
  /**
   * Sends a message. The box clears at once (the message shows optimistically
   * elsewhere); a rejection puts the text back and shows the error.
   */
  onSend: (text: string) => Promise<void>;
  /** Present while a run is working; an empty box then shows Stop. */
  onStop?: () => void;
  stopping?: boolean;
  /** Why sending is unavailable, when it is. */
  disabledReason?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
  /** Up arrow in an empty box recalls this (the last message sent). */
  lastSentText?: string;
  /** Left side of the toolbar, e.g. the trust cue. */
  leading?: ReactNode;
  /**
   * Sections at the top of the box, above the message field: a change
   * waiting for approval, queued messages. Each is divided by one rule.
   */
  requests?: ReactNode;
};

function errorText(errors: unknown[]): string | null {
  const messages = errors
    .map((error) => (typeof error === 'string' ? error : (error as { message?: string } | undefined)?.message))
    .filter(Boolean);
  return messages.length ? messages.join(', ') : null;
}

/**
 * The message box: one surface (shadcn InputGroup) with a hairline outline,
 * an auto-growing field and a toolbar row, after T3 Code's composer. Any
 * requests (approval, queue) are sections at its top, divided by one rule.
 */
export function AssistantComposer({
  onSend,
  onStop,
  stopping = false,
  disabledReason,
  placeholder = 'Ask about students, classes, exams…',
  autoFocus = false,
  lastSentText,
  leading,
  requests,
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
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <InputGroup
        className={cn(
          'relative h-auto flex-col rounded-2xl border-0 bg-card shadow-composer dark:bg-card',
          'after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-surface-outline dark:after:inset-shadow-surface-highlight',
          'has-[[data-slot=input-group-control]:focus-visible]:border-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0',
          'has-[textarea]:rounded-2xl has-[>[data-align=block-end]]:rounded-2xl',
          disabled && 'opacity-70',
        )}
      >
        {requests ? (
          <div className="flex w-full min-w-0 flex-col divide-y divide-surface-outline border-b border-surface-outline">{requests}</div>
        ) : null}
        <form.Field name="text">
          {(field) => (
            <InputGroupTextarea
              aria-label="Message"
              autoFocus={autoFocus}
              disabled={disabled}
              rows={2}
              maxLength={ASSISTANT_MESSAGE_MAX_LENGTH}
              placeholder={disabledReason ?? placeholder}
              className="max-h-52 min-h-[calc(2lh+0.875rem)] px-4 pt-3.5 pb-0 text-base/relaxed placeholder:text-muted-foreground sm:text-sm/relaxed md:text-sm/relaxed"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              onKeyDown={(event) => handleKeyDown(event, field.state.value)}
            />
          )}
        </form.Field>
        <InputGroupAddon align="block-end" className="cursor-default gap-2 px-2 pt-1 pb-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 ps-2 text-xs font-normal text-muted-foreground">
            {leading}
          </div>
          <form.Subscribe selector={(state) => [state.values.text.trim().length > 0, state.isSubmitting] as const}>
            {([hasText, isSubmitting]) =>
              onStop && !hasText ? (
                <StopButton onStop={onStop} stopping={stopping} />
              ) : (
                <SendButton disabled={disabled || !hasText} busy={isSubmitting} queue={Boolean(onStop)} />
              )
            }
          </form.Subscribe>
        </InputGroupAddon>
      </InputGroup>
      <form.Subscribe selector={(state) => [state.errors, state.fieldMeta.text?.errors ?? []] as const}>
        {([formErrors, fieldErrors]) => {
          const message = errorText([...fieldErrors, ...formErrors]);
          return message ? (
            <p role="alert" className="px-3 text-xs text-destructive">
              {message}
            </p>
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

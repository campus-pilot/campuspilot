import { ASSISTANT_MESSAGE_MAX_LENGTH } from '@campuspilot/assistant-contract/dto';
import { Button } from '@campuspilot/ui/components/button';
import { InputGroup, InputGroupAddon, InputGroupTextarea } from '@campuspilot/ui/components/input-group';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { cn } from '@campuspilot/ui/lib/utils';
import { useForm } from '@tanstack/react-form';
import { ListPlus, X } from 'lucide-react';
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
  'relative isolate flex size-9 shrink-0 items-center justify-center rounded-full shadow-xs transition-[scale,background-color,box-shadow] duration-150 motion-reduce:transition-none enabled:cursor-pointer active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none sm:size-8 [&_svg]:pointer-events-none';

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

/**
 * Send, or Queue while a run works. A disabled button takes no pointer
 * events, so the tooltip hangs on a wrapper instead: hovering a Send that
 * cannot be pressed then says why (`disabledReason`), rather than nothing.
 */
function SendButton({
  disabledReason,
  busy,
  queue,
}: {
  /** Why nothing can be sent right now; null when it can. */
  disabledReason: string | null;
  busy: boolean;
  queue: boolean;
}) {
  const label = busy ? 'Sending message' : queue ? 'Queue message' : 'Send message';
  const hint = busy ? 'Sending…' : queue ? 'Queue — sends when the assistant is done' : 'Send';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex shrink-0 rounded-full">
          <button
            type="submit"
            aria-label={label}
            disabled={Boolean(disabledReason) || busy}
            onPointerDown={keepComposerFocus}
            className={cn(
              roundButtonClassName,
              'bg-primary text-primary-foreground shadow-primary/25 inset-shadow-control-highlight enabled:hover:scale-105 enabled:hover:bg-primary/90 motion-reduce:enabled:hover:scale-100 active:inset-shadow-control-pressed disabled:bg-assistant-send-disabled disabled:text-assistant-send-disabled-foreground disabled:shadow-none disabled:inset-shadow-none',
            )}
          >
            {busy ? <Spinner className="size-3.5" /> : queue ? <ListPlus className="size-4" /> : <SendGlyph />}
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{disabledReason ?? hint}</TooltipContent>
    </Tooltip>
  );
}

export type AssistantComposerProps = {
  /**
   * Sends a message. The box clears at once (the message shows optimistically
   * elsewhere); a rejection shows the error and puts the text back, unless
   * the user has typed something else meanwhile, which is kept instead.
   * `box.text()` reads what the box holds at that moment (text typed while
   * the send is on its way, or nothing), never the text being sent.
   */
  onSend: (text: string, box: { text: () => string }) => Promise<void>;
  /**
   * Whether a send is in flight. The send button shows it and nothing else
   * can be sent until it settles; a draft typed meanwhile stays in the box.
   * It comes from the caller's request state because the form clears itself
   * the moment a message is handed over, so it cannot tell.
   */
  sending?: boolean;
  /** Present while a run is working; an empty box then shows Stop. */
  onStop?: () => void;
  stopping?: boolean;
  /** Why sending is unavailable, when it is. */
  disabledReason?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
  /**
   * A draft saved earlier for this conversation, put in the box when it
   * mounts. Read once: later changes to this prop are ignored, so it never
   * overwrites what is being typed.
   */
  initialText?: string;
  /**
   * Reports the box's text so the caller can keep it as a draft: on every
   * edit, and once more when a send settles (empty after a successful send,
   * the restored text after a failed one).
   */
  onDraftChange?: (text: string) => void;
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
  sending = false,
  onStop,
  stopping = false,
  disabledReason,
  placeholder = 'Ask about students, classes, exams…',
  autoFocus = false,
  initialText = '',
  onDraftChange,
  lastSentText,
  leading,
  requests,
}: AssistantComposerProps) {
  const form = useForm({
    defaultValues: { text: '' },
    validators: { onSubmit: composerSchema },
    listeners: {
      // A saved draft goes into the box as the form mounts. It is deliberately
      // not the default value: `reset()` after a send returns to the default,
      // which must stay empty or the sent text would come back.
      onMount: ({ formApi }) => {
        if (initialText) formApi.setFieldValue('text', initialText, { dontRunListeners: true, dontValidate: true });
      },
    },
    onSubmit: async ({ value, formApi }) => {
      const text = value.text.trim();
      if (!text || sending) return;
      // The saved draft is left alone here: it is cleared only once the send
      // has succeeded, so a failed send (or a reload meanwhile) keeps the text.
      formApi.reset();
      try {
        await onSend(text, { text: () => formApi.getFieldValue('text') });
      } catch (error) {
        if (!formApi.getFieldValue('text')) formApi.setFieldValue('text', text);
        formApi.setErrorMap({
          onSubmit: { form: error instanceof Error ? error.message : 'The message could not be sent.', fields: {} },
        });
      }
      // Whatever the box holds now is the draft: nothing after a successful
      // send, the restored text after a failed one, or what was typed meanwhile.
      onDraftChange?.(formApi.getFieldValue('text'));
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
        <form.Field name="text" listeners={{ onChange: ({ value }) => onDraftChange?.(value) }}>
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
          <form.Subscribe selector={(state) => state.values.text.trim().length > 0}>
            {(hasText) =>
              onStop && !hasText ? (
                <StopButton onStop={onStop} stopping={stopping} />
              ) : (
                <SendButton
                  disabledReason={disabledReason ?? (hasText ? null : 'Type a message')}
                  busy={sending}
                  queue={Boolean(onStop)}
                />
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

export type AssistantQueuedMessage = {
  id: string;
  text: string;
  /** Replaces the "Queued" label, e.g. while a message is still on its way. */
  status?: ReactNode;
  /** Whether it can still be taken out of the queue (it is saved and has not started). */
  removable?: boolean;
};

/** One queued message: what it says, where it stands, and a way to take it back. */
function QueuedMessageRow({ message, onRemove }: { message: AssistantQueuedMessage; onRemove?: (id: string) => void }) {
  return (
    <li className="group/queued flex min-h-7 min-w-0 items-center gap-2 px-1.5 text-assistant-dim">
      <ListPlus className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{message.text}</span>
      <span className="shrink-0">{message.status ?? 'Queued'}</span>
      {message.removable && onRemove ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove from queue"
              // Shown on hover or focus; always on touch screens, which cannot hover.
              className="-me-1 text-assistant-dim opacity-0 transition-opacity duration-200 hover:text-foreground group-hover/queued:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none"
              onPointerDown={keepComposerFocus}
              onClick={() => onRemove(message.id)}
            >
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove from queue</TooltipContent>
        </Tooltip>
      ) : null}
    </li>
  );
}

/**
 * Messages waiting behind the working run, as compact rows at the top of
 * the composer (T3 Code moved its queue out of the timeline: they have not
 * been answered yet, so they do not belong in the conversation). A message
 * that has not started can be removed (`onRemove`), so a wrong follow-up
 * never runs.
 */
export function AssistantQueuedMessages({
  messages,
  onRemove,
}: {
  messages: readonly AssistantQueuedMessage[];
  onRemove?: (id: string) => void;
}) {
  if (messages.length === 0) return null;
  return (
    <ul aria-label="Queued messages" className="flex min-w-0 flex-col px-2 py-1.5 text-xs">
      {messages.map((message) => (
        <QueuedMessageRow key={message.id} message={message} onRemove={onRemove} />
      ))}
    </ul>
  );
}

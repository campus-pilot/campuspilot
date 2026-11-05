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
 * A press on the input surface's padding focuses the message box instead of
 * blurring it, so the whole surface behaves like the field.
 */
function focusPromptFromPadding(event: PointerEvent<HTMLDivElement>) {
  const target = event.target as Element;
  if (target.closest('textarea, button, a')) return;
  event.preventDefault();
  event.currentTarget.querySelector('textarea')?.focus();
}

const slotClassName =
  'relative isolate flex h-full shrink-0 items-center justify-center gap-1 rounded-[7px] transition-colors duration-150 outline-none enabled:cursor-pointer enabled:hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none [&_svg]:pointer-events-none';

/**
 * Send, queue and stop share one neutral pill, one shape in every state
 * (T3 Code), so the control never jumps or changes colour under the cursor.
 */
function PrimaryAction({
  mode,
  disabled,
  busy,
  stopping,
  onStop,
}: {
  mode: 'send' | 'queue' | 'stop';
  disabled: boolean;
  busy: boolean;
  stopping: boolean;
  onStop?: () => void;
}) {
  const tooltip = mode === 'stop' ? 'Stop' : mode === 'queue' ? 'Queue: sends when the assistant is done' : 'Send';
  const button =
    mode === 'stop' ? (
      <button
        type="button"
        aria-label="Stop"
        disabled={stopping}
        onPointerDown={keepComposerFocus}
        onClick={onStop}
        className={cn(slotClassName, 'w-[30px] disabled:opacity-64')}
      >
        {stopping ? <Spinner className="size-3.5" /> : <span className="size-2.5 rounded-[2px] bg-destructive" aria-hidden />}
      </button>
    ) : (
      <button
        type="submit"
        aria-label={busy ? 'Sending message' : mode === 'queue' ? 'Queue message' : 'Send message'}
        disabled={disabled || busy}
        onPointerDown={keepComposerFocus}
        className={cn(slotClassName, mode === 'queue' ? 'ps-1.5 pe-2.5 text-sm font-medium' : 'w-[30px]', 'disabled:opacity-64')}
      >
        {busy ? (
          <Spinner className="size-3.5" />
        ) : mode === 'queue' ? (
          <>
            <ListPlus className="size-3.5" aria-hidden />
            Queue
          </>
        ) : (
          <ArrowUp className="size-3.5" strokeWidth={2.25} aria-hidden />
        )}
      </button>
    );
  return (
    <Tooltip>
      {/* The trigger is the pill, not the button, so the tooltip still shows while sending is disabled. */}
      <TooltipTrigger asChild>
        <span className="relative isolate inline-flex h-8 shrink-0 items-center rounded-lg assistant-pill">{button}</span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
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
   * Cards that live in the tray above the message box: a change waiting for
   * approval, queued messages. They sit on the tray, the box stays raised.
   */
  requests?: ReactNode;
  /** The tray row under the box, start and end. */
  trayStart?: ReactNode;
  trayEnd?: ReactNode;
};

function errorText(errors: unknown[]): string | null {
  const messages = errors
    .map((error) => (typeof error === 'string' ? error : (error as { message?: string } | undefined)?.message))
    .filter(Boolean);
  return messages.length ? messages.join(', ') : null;
}

/**
 * The message box, after T3 Code's redesigned composer: one tray (16px
 * radius, hairline painted on top so it adds no size) holding any requests,
 * a raised 48px input surface (14px radius, concentric with the tray) with
 * the send pill on its first line, and a 30px context row below.
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
  trayStart,
  trayEnd,
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
      <div
        className={cn(
          'relative isolate flex min-w-0 flex-col rounded-2xl assistant-tray',
          'after:pointer-events-none after:absolute after:inset-0 after:z-20 after:rounded-[inherit] after:border after:border-[var(--assistant-tray-stroke)]',
        )}
      >
        {requests}
        <div
          className={cn('relative z-10 cursor-text rounded-[14px] assistant-input', disabled && 'opacity-70')}
          onPointerDown={focusPromptFromPadding}
        >
          <div className="flex min-h-12 items-start gap-1.5 py-2 ps-3.5 pe-2">
            <form.Field name="text">
              {(field) => (
                <InputGroupTextarea
                  aria-label="Message the assistant"
                  autoFocus={autoFocus}
                  disabled={disabled}
                  rows={1}
                  maxLength={ASSISTANT_MESSAGE_MAX_LENGTH}
                  placeholder={disabledReason ?? placeholder}
                  className="max-h-42 min-h-8 px-0 py-1.5 text-base/5 text-foreground placeholder:text-assistant-dim sm:text-sm/5 md:text-sm/5"
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
                  disabled={disabled || !hasText}
                  busy={isSubmitting}
                  stopping={stopping}
                  onStop={onStop}
                />
              )}
            </form.Subscribe>
          </div>
        </div>
        <div className="flex h-7.5 min-w-0 items-center gap-2 ps-3.5 pe-3 text-xs text-muted-foreground">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">{trayStart}</div>
          {trayEnd ? <div className="flex shrink-0 items-center gap-1.5">{trayEnd}</div> : null}
        </div>
      </div>
      <form.Subscribe selector={(state) => [state.errors, state.fieldMeta.text?.errors ?? []] as const}>
        {([formErrors, fieldErrors]) => {
          const message = errorText([...fieldErrors, ...formErrors]);
          return message ? (
            <p role="alert" className="px-3.5 text-xs text-destructive">
              {message}
            </p>
          ) : null;
        }}
      </form.Subscribe>
    </form>
  );
}

/**
 * Messages waiting behind the working run, as compact rows in the tray
 * (T3 Code moved its queue out of the timeline for the same reason: they
 * have not been answered yet, so they do not belong in the conversation).
 */
export function AssistantQueuedMessages({
  messages,
}: {
  /** `status` replaces the "Queued" label, e.g. while a message is still on its way. */
  messages: readonly { id: string; text: string; status?: ReactNode }[];
}) {
  if (messages.length === 0) return null;
  return (
    <ul aria-label="Queued messages" className="flex min-w-0 flex-col px-2 py-1 text-xs">
      {messages.map((message) => (
        <li key={message.id} className="flex min-h-7 min-w-0 items-center gap-2 rounded-lg px-1.5 text-assistant-dim">
          <ListPlus className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{message.text}</span>
          <span className="shrink-0">{message.status ?? 'Queued'}</span>
        </li>
      ))}
    </ul>
  );
}

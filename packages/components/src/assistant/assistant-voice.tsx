'use client';

import { Button } from '@campuspilot/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { cn } from '@campuspilot/ui/lib/utils';
import { AudioLines, ChevronDown, ChevronUp, Keyboard, Maximize2, Mic, MicOff, Minimize2, X } from 'lucide-react';
import { useCallback, type ReactNode } from 'react';

import { roundButtonClassName } from './assistant-composer';
import { ASSISTANT_VOICE_ACTIVITY_LABEL, smoothedLevel, voiceBarLine, voiceHeaderLine, type AssistantVoiceActivity } from './assistant-voice-model';

/**
 * Voice mode's pieces, presentational only: the app owns the microphone, the
 * session and its state (`apps/management/components/assistant/voice`), and
 * passes what to show.
 *
 * Voice replaces only the message box and adds a header over the
 * conversation. The conversation itself stays as it is: a spoken request is
 * an ordinary message, so its steps, tables, drafts and the change waiting
 * for approval are the chat's own rows, never copies made for voice.
 */

/** How loud the microphone and the assistant's voice are right now, each 0 to 1. */
export type AssistantVoiceLevels = () => { input: number; output: number };

/**
 * The assistant in voice mode: a round head in the brand colour, wearing the
 * cap of the CampusPilot mark. Its motion is the real signal: `levels` is read
 * every frame and written to the two CSS variables its styles follow
 * (`assistant.css`), so it is still whenever there is no sound.
 *
 * Decorative: what it shows is always said in words beside it.
 */
export function AssistantVoiceAvatar({
  activity,
  levels,
  className,
}: {
  activity: AssistantVoiceActivity;
  levels: AssistantVoiceLevels;
  className?: string;
}) {
  // A ref callback, not an effect: the frame loop belongs to the element and ends with it.
  const follow = useCallback(
    (node: SVGSVGElement | null) => {
      if (!node) return;
      let frame = 0;
      let input = 0;
      let output = 0;
      const paint = () => {
        const now = levels();
        input = smoothedLevel(input, now.input);
        output = smoothedLevel(output, now.output);
        node.style.setProperty('--voice-in', input.toFixed(3));
        node.style.setProperty('--voice-out', output.toFixed(3));
        frame = requestAnimationFrame(paint);
      };
      frame = requestAnimationFrame(paint);
      return () => cancelAnimationFrame(frame);
    },
    [levels],
  );
  return (
    <svg ref={follow} viewBox="0 0 96 96" aria-hidden="true" data-activity={activity} className={cn('assistant-voice-avatar shrink-0', className)}>
      <g className="va-body">
        <circle className="va-ring" cx="48" cy="58" r="33" />
        <circle className="va-head" cx="48" cy="58" r="28" />
        <g className="va-eyes">
          <rect className="va-eye" x="35" y="52.5" width="7.5" height="13" rx="3.75" />
          <rect className="va-eye" x="53.5" y="52.5" width="7.5" height="13" rx="3.75" />
        </g>
        {/* The cap of the CampusPilot mark, set on the head. */}
        <g transform="translate(48 22) rotate(-7) scale(1.3) translate(-34.5 -30)">
          <path className="va-hat" strokeWidth="0" d="M26.5 35 34.5 39 42.5 35V40C42.5 42 39 44 34.5 44S26.5 42 26.5 40Z" />
          <path className="va-hat" strokeWidth="2" strokeLinejoin="round" d="M34.5 21.5 49 28 34.5 34.5 20 28Z" />
          <path className="va-tassel" d="M46.5 29V37.5" />
        </g>
      </g>
    </svg>
  );
}

/**
 * The assistant with what it is saying (`voiceHeaderLine`), over the
 * conversation. What it is doing is said in words by the voice bar's label.
 * - `hero`: a new conversation. The assistant is large and centred, greeting.
 * - otherwise a row at the top of the conversation, so the answer below has
 *   the room.
 */
export function AssistantVoiceHeader({
  activity,
  levels,
  speech,
  hero = false,
  compact = false,
}: {
  activity: AssistantVoiceActivity;
  levels: AssistantVoiceLevels;
  /** What the assistant is saying, or said last; empty before it has spoken. */
  speech: string;
  hero?: boolean;
  /** Smaller headline for tight surfaces (palette, panel). */
  compact?: boolean;
}) {
  const line = voiceHeaderLine({ activity, said: speech });
  if (hero) {
    return (
      <div className="flex flex-col items-center gap-4 px-2 text-center">
        <AssistantVoiceAvatar activity={activity} levels={levels} className={compact ? 'size-20' : 'size-28'} />
        <div className="flex flex-col items-center gap-1">
          <h2 className={cn('font-semibold text-balance text-foreground', compact ? 'text-[15px]/[1.38]' : 'text-[22px]/[1.27] tracking-[-0.01em]')}>{line}</h2>
          <p className="max-w-sm text-sm/[1.45] text-balance text-muted-foreground">
            {activity === 'muted' ? 'Turn the microphone on to talk.' : 'Just say it. I work with your permissions, and ask before changing anything.'}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <AssistantVoiceAvatar activity={activity} levels={levels} className="size-12" />
      <p className="line-clamp-2 min-w-0 text-sm/[1.45] font-medium text-foreground">{line}</p>
    </div>
  );
}

/**
 * The voice bar, in the message box's place and on its surface: what the
 * user said, what the assistant is doing in words, and the three controls.
 * The tray above it (`requests`) is the message box's own, so a change
 * waiting for approval stays where it always is, with its two buttons.
 * Speech never approves: only that card does.
 */
export function AssistantVoiceBar({
  activity,
  heard,
  heardFinal,
  muted,
  requests,
  onMutedChange,
  onType,
  onEnd,
}: {
  activity: AssistantVoiceActivity;
  /** What the user said last, and whether that utterance is complete. */
  heard: string;
  heardFinal: boolean;
  muted: boolean;
  requests?: ReactNode;
  onMutedChange: (muted: boolean) => void;
  /** Ends voice and gives the message box back. */
  onType: () => void;
  onEnd: () => void;
}) {
  const line = voiceBarLine({ activity, heard, heardFinal });
  return (
    <div
      className={cn(
        'relative flex flex-col rounded-2xl bg-card shadow-composer',
        'after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-surface-outline dark:after:inset-shadow-surface-highlight',
      )}
    >
      {requests ? (
        <div className="flex w-full min-w-0 flex-col divide-y divide-surface-outline border-b border-surface-outline">{requests}</div>
      ) : null}
      <p
        aria-live="polite"
        className={cn(
          // Two lines tall, like the empty message box, so starting and ending voice does not move the conversation.
          'line-clamp-2 min-h-[calc(2lh+0.875rem)] px-4 pt-3.5 text-base/relaxed sm:text-sm/relaxed',
          line.own ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {line.text}
      </p>
      <div className="flex items-center gap-2 px-2 pt-1 pb-2">
        <span role="status" className="min-w-0 flex-1 truncate ps-2 text-xs text-muted-foreground">
          {ASSISTANT_VOICE_ACTIVITY_LABEL[activity]}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={muted ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label={muted ? 'Turn the microphone on' : 'Turn the microphone off'}
              aria-pressed={muted}
              className="shrink-0 rounded-full"
              onClick={() => onMutedChange(!muted)}
            >
              {muted ? <MicOff /> : <Mic />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{muted ? 'Microphone is off' : 'Mute'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Type instead" className="shrink-0 rounded-full text-muted-foreground" onClick={onType}>
              <Keyboard />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Type instead</TooltipContent>
        </Tooltip>
        <Button type="button" variant="secondary" size="sm" className="shrink-0 rounded-full" onClick={onEnd}>
          End
        </Button>
      </div>
    </div>
  );
}

/**
 * Voice mode as a layer over the app (the overlay): a pill docked at the
 * bottom of the window with the assistant in it, and above it, when there is
 * something to show, the conversation in a panel the user can hide.
 *
 * - The pill is always there while voice is on: the assistant, what it is
 *   saying, what the user said, the microphone and End.
 * - A change waiting for approval sits between the two, on its own card, so it
 *   stays in view with its two buttons whether or not the panel is open.
 * - The panel is as tall as what it holds, up to about half the window; it
 *   scrolls beyond that. Hiding it leaves the page underneath free; a button
 *   on the pill brings it back.
 * - Expanded, the whole layer fills the window over a blurred page: the
 *   conversation gets the room, the pill stays at the bottom, and the page the
 *   user is on stays where it is underneath. Nothing navigates.
 */
export function AssistantVoiceDock({
  activity,
  levels,
  speech,
  heard,
  heardFinal,
  muted,
  requests,
  panel,
  panelOpen,
  onPanelOpenChange,
  expanded,
  onExpandedChange,
  onMutedChange,
  onEnd,
}: {
  activity: AssistantVoiceActivity;
  levels: AssistantVoiceLevels;
  /** What the assistant is saying, or said last. */
  speech: string;
  heard: string;
  heardFinal: boolean;
  muted: boolean;
  /** A change waiting for the user's decision, and messages queued behind a working turn. */
  requests?: ReactNode;
  /** The conversation of this session; null before anything was asked. */
  panel: ReactNode | null;
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  /** Whether the layer fills the window. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onMutedChange: (muted: boolean) => void;
  onEnd: () => void;
}) {
  const said = voiceHeaderLine({ activity, said: speech });
  const line = voiceBarLine({ activity, heard, heardFinal });
  const showPanel = Boolean(panel) && (panelOpen || expanded);
  const layer = (
    <div className={cn('flex flex-col gap-2', expanded && 'mx-auto size-full max-w-3xl')}>
      {panel && showPanel ? (
        <section
          aria-label="Assistant"
          className={cn(
            'assistant-voice-rise flex min-h-0 flex-col overflow-hidden rounded-3xl border border-surface-outline bg-background/95 shadow-2xl backdrop-blur-xl',
            expanded ? 'flex-1' : 'max-h-[min(52dvh,30rem)]',
          )}
        >
          <header className="flex shrink-0 items-center gap-0.5 border-b border-assistant-hairline py-1 ps-4 pe-1.5">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">Assistant</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={expanded ? 'Make smaller' : 'Full screen'}
                  className="text-muted-foreground"
                  onClick={() => onExpandedChange(!expanded)}
                >
                  {expanded ? <Minimize2 /> : <Maximize2 />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{expanded ? 'Make smaller' : 'Full screen'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Hide"
                  className="text-muted-foreground"
                  onClick={() => {
                    onExpandedChange(false);
                    onPanelOpenChange(false);
                  }}
                >
                  <ChevronDown />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Hide</TooltipContent>
            </Tooltip>
          </header>
          {/* A flex column all the way down, so the conversation is as tall as its content and scrolls once it reaches the panel's limit. */}
          <div className={cn('flex min-h-0 flex-col', expanded && 'flex-1')}>{panel}</div>
        </section>
      ) : null}
      {requests ? (
        <div className="assistant-voice-rise flex flex-col divide-y divide-surface-outline overflow-hidden rounded-2xl border border-surface-outline bg-card shadow-xl">{requests}</div>
      ) : null}
      <div data-activity={activity} className="assistant-voice-pill flex items-center gap-3 rounded-[1.75rem] border border-surface-outline bg-card/95 py-2 ps-3 pe-2 backdrop-blur-xl">
        <AssistantVoiceAvatar activity={activity} levels={levels} className="size-11" />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="line-clamp-2 text-sm/[1.4] font-medium text-foreground">{said}</p>
          <p aria-live="polite" className={cn('truncate text-xs', line.own ? 'text-foreground' : 'text-muted-foreground')}>
            {line.text}
          </p>
        </div>
        {/* What it is doing, in words, for someone who cannot see the avatar. */}
        <span role="status" className="sr-only">
          {ASSISTANT_VOICE_ACTIVITY_LABEL[activity]}
        </span>
        {panel && !showPanel ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="Show the answer" className="shrink-0 rounded-full text-muted-foreground" onClick={() => onPanelOpenChange(true)}>
                <ChevronUp />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Show the answer</TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={muted ? 'secondary' : 'ghost'}
              size="icon"
              aria-label={muted ? 'Turn the microphone on' : 'Turn the microphone off'}
              aria-pressed={muted}
              className="shrink-0 rounded-full"
              onClick={() => onMutedChange(!muted)}
            >
              {muted ? <MicOff /> : <Mic />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{muted ? 'Microphone is off' : 'Mute'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="secondary" size="icon" aria-label="End voice" className="shrink-0 rounded-full" onClick={onEnd}>
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>End voice</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
  if (!expanded) return layer;
  return (
    // Over the whole window: the page stays where it is underneath, blurred, and comes back as it was.
    <div className="fixed inset-0 z-50 flex flex-col bg-background/75 p-3 backdrop-blur-md sm:p-6">{layer}</div>
  );
}

/** The glyph of every button that starts voice: sound, not a microphone (which means "mute" inside voice mode). */
export function AssistantVoiceButtonIcon({ className }: { className?: string }) {
  return <AudioLines className={className} aria-hidden />;
}

/**
 * The button that starts voice mode, in the message box's toolbar beside
 * Send and in its family (round, the same size). Its glyph is sound, not a
 * microphone: the microphone glyph means "mute" inside voice mode.
 */
export function AssistantVoiceButton({ onStart, disabledReason }: { onStart: () => void; disabledReason?: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex shrink-0 rounded-full">
          <button
            type="button"
            aria-label="Talk to the assistant"
            disabled={Boolean(disabledReason)}
            onClick={onStart}
            className={cn(roundButtonClassName, 'text-muted-foreground shadow-none enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-50')}
          >
            <AssistantVoiceButtonIcon className="size-4" />
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{disabledReason ?? 'Talk to the assistant'}</TooltipContent>
    </Tooltip>
  );
}

/** Why voice is not on (it ended on its own, or could not start), in the message box's tray until dismissed. */
export function AssistantVoiceNotice({ message, problem, onDismiss }: { message: string; problem: boolean; onDismiss: () => void }) {
  return (
    <div role="status" className="flex items-center gap-2 px-3 py-1.5">
      <p className={cn('min-w-0 flex-1 text-xs', problem ? 'text-assistant-warning' : 'text-muted-foreground')}>{message}</p>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Dismiss" className="shrink-0 text-muted-foreground" onClick={onDismiss}>
        <X />
      </Button>
    </div>
  );
}

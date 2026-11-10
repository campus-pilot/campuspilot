import type { AssistantConversationAttention } from '@campuspilot/assistant-contract/dto';
import { cn } from '@campuspilot/ui/lib/utils';

/** The states the history list marks: the ones that are still open. */
type MarkedAttention = Exclude<AssistantConversationAttention, 'failed'>;

/** What each dot means, in words, for screen readers and as a tooltip. */
const ATTENTION_LABEL: Record<MarkedAttention, string> = {
  approval: 'Waiting for your approval',
  working: 'The assistant is working',
};

/** Amber asks for a decision; the shimmer says work is going on. */
const ATTENTION_TONE: Record<MarkedAttention, string> = {
  approval: 'bg-assistant-warning',
  working: 'assistant-shimmer-dot',
};

/**
 * A 6px dot before a conversation's title in the history list, saying what
 * it needs noticing for (after T3 Code's thread status). Nothing is rendered
 * for a conversation that needs nothing, so quiet rows stay quiet. A failed
 * last request gets no dot either: nothing records whether the user has seen
 * it, so every old failure would stay red for good and the list would read
 * as a wall of alarms. The failure is shown, with "Try again", in the
 * conversation itself.
 */
export function AssistantAttentionDot({ attention }: { attention: AssistantConversationAttention | null }) {
  if (!attention || attention === 'failed') return null;
  return (
    <span
      role="img"
      aria-label={ATTENTION_LABEL[attention]}
      title={ATTENTION_LABEL[attention]}
      className={cn('size-1.5 shrink-0 rounded-full', ATTENTION_TONE[attention])}
    />
  );
}

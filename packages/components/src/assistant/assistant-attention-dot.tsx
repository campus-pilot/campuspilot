import type { AssistantConversationAttention } from '@campuspilot/assistant-contract/dto';
import { cn } from '@campuspilot/ui/lib/utils';

/** What each dot means, in words, for screen readers and as a tooltip. */
const ATTENTION_LABEL: Record<AssistantConversationAttention, string> = {
  approval: 'Waiting for your approval',
  working: 'The assistant is working',
};

/** Amber asks for a decision; the shimmer says work is going on. */
const ATTENTION_TONE: Record<AssistantConversationAttention, string> = {
  approval: 'bg-assistant-warning',
  working: 'assistant-shimmer-dot',
};

/**
 * A 6px dot before a conversation's title in the history list, saying what
 * it needs noticing for (after T3 Code's thread status). Nothing is rendered
 * for a conversation that needs nothing, so quiet rows stay quiet.
 */
export function AssistantAttentionDot({ attention }: { attention: AssistantConversationAttention | null }) {
  if (!attention) return null;
  return (
    <span
      role="img"
      aria-label={ATTENTION_LABEL[attention]}
      title={ATTENTION_LABEL[attention]}
      className={cn('size-1.5 shrink-0 rounded-full', ATTENTION_TONE[attention])}
    />
  );
}

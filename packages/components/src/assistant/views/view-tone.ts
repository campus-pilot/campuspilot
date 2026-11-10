import type { AssistantViewTone } from '@campuspilot/assistant-contract/views';

/**
 * Tones in the app's existing vocabulary: emerald for done/healthy and amber
 * for attention are how the dashboard and session badges already show them
 * (the palette has no success or warning token).
 */
export const TONE_TEXT: Record<AssistantViewTone, string> = {
  neutral: 'text-muted-foreground',
  positive: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-500',
  negative: 'text-destructive',
};

export const TONE_DOT: Record<AssistantViewTone, string> = {
  neutral: 'bg-muted-foreground/40',
  positive: 'bg-emerald-500',
  warning: 'bg-amber-500',
  negative: 'bg-destructive',
};

export const TONE_BAR: Record<AssistantViewTone, string> = {
  neutral: 'bg-primary',
  positive: 'bg-emerald-500',
  warning: 'bg-amber-500',
  negative: 'bg-destructive',
};

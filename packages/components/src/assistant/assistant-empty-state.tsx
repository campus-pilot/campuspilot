import { Button } from '@campuspilot/ui/components/button';
import { Sparkles } from 'lucide-react';

export type AssistantSuggestion = { id: string; label: string; prompt: string };

/** First screen of a new conversation: what the assistant is, and a few starts. */
export function AssistantEmptyState({
  suggestions,
  onPick,
  compact = false,
}: {
  suggestions: readonly AssistantSuggestion[];
  onPick: (prompt: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <Sparkles className="size-5 text-muted-foreground" aria-hidden />
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">CampusPilot assistant</h2>
        {compact ? null : (
          <p className="max-w-sm text-xs text-muted-foreground">
            It works with your permissions. Anything that changes data waits for your approval.
            Fees and payments are not available yet.
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {suggestions.map((suggestion) => (
          <Button key={suggestion.id} type="button" variant="outline" onClick={() => onPick(suggestion.prompt)}>
            {suggestion.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

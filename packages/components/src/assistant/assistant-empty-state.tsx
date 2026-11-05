import { cn } from '@campuspilot/ui/lib/utils';
import { Sparkles, type LucideIcon } from 'lucide-react';

export type AssistantSuggestion = { id: string; label: string; prompt: string; icon?: LucideIcon };

/**
 * The new-conversation headline: a raised disc, a title and one muted line
 * (T3 Code's empty state). The composer sits right under it.
 */
export function AssistantWelcome({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 px-2 text-center">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full assistant-raised text-muted-foreground">
        <Sparkles className="size-4.5" aria-hidden />
      </span>
      <div className="flex flex-col items-center gap-1">
        <h2
          className={cn(
            'font-semibold text-foreground',
            compact ? 'text-[15px]/[1.38]' : 'text-[22px]/[1.27] tracking-[-0.01em]',
          )}
        >
          What can I help with?
        </h2>
        <p className="max-w-sm text-sm/[1.45] text-balance text-muted-foreground">
          I work with your permissions, and ask before changing anything.
        </p>
      </div>
    </div>
  );
}

/** A few starting points under the composer, as menu rows rather than buttons. */
export function AssistantSuggestions({
  suggestions,
  onPick,
}: {
  suggestions: readonly AssistantSuggestion[];
  onPick: (prompt: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-px px-1" aria-label="Suggestions">
      {suggestions.map((suggestion) => {
        const Icon = suggestion.icon;
        return (
          <li key={suggestion.id}>
            <button
              type="button"
              onClick={() => onPick(suggestion.prompt)}
              className="group/suggestion flex min-h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1 text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground hover:assistant-ghost-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
            >
              {Icon ? (
                <Icon
                  className="size-[15px] shrink-0 text-assistant-dim transition-colors group-hover/suggestion:text-foreground"
                  aria-hidden
                />
              ) : null}
              <span className="min-w-0 flex-1 truncate">{suggestion.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

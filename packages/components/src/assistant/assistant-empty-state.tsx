import { ArrowUpRight } from 'lucide-react';

export type AssistantSuggestion = { id: string; label: string; prompt: string };

/** The new-conversation headline; the composer sits right under it. */
export function AssistantWelcome({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 px-2 text-center">
      <h2 className={compact ? 'text-xl font-normal tracking-tight' : 'text-2xl font-normal tracking-tight sm:text-3xl'}>
        What can I help with?
      </h2>
      <p className="max-w-sm text-sm/relaxed text-balance text-muted-foreground">
        I work with your permissions, and ask before changing anything.
      </p>
    </div>
  );
}

/** A few starting points under the composer, as quiet rows rather than buttons. */
export function AssistantSuggestions({
  suggestions,
  onPick,
}: {
  suggestions: readonly AssistantSuggestion[];
  onPick: (prompt: string) => void;
}) {
  return (
    <ul className="flex flex-col">
      {suggestions.map((suggestion) => (
        <li key={suggestion.id} className="border-b border-border/60 last:border-b-0">
          <button
            type="button"
            onClick={() => onPick(suggestion.prompt)}
            className="group/suggestion flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="min-w-0 flex-1 truncate">{suggestion.label}</span>
            <ArrowUpRight
              className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/suggestion:opacity-100"
              aria-hidden
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

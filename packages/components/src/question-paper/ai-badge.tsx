import { Sparkles } from 'lucide-react';

/**
 * Marks a tab or action as AI powered (decision D42). The visible text is the
 * accessible name, so the icon stays decorative.
 */
export function AiBadge({ onPrimary = false }: { /** Set inside a filled primary button, where the default tint would vanish. */ onPrimary?: boolean }) {
  return (
    <span
      className={`inline-flex h-4 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[0.625rem] font-medium leading-none ${onPrimary ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/10 text-primary'}`}
    >
      <Sparkles className="size-2.5" aria-hidden />
      AI
    </span>
  );
}

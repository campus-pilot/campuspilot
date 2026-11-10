import { Button } from '@campuspilot/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { AlertCircle, Check, Copy } from 'lucide-react';
import { useState } from 'react';

type CopyOutcome = 'idle' | 'copied' | 'failed';

const OUTCOME_LABEL: Record<Exclude<CopyOutcome, 'idle'>, string> = { copied: 'Copied', failed: 'Copy failed' };

/**
 * Copies text. The result is said twice, so it is never missed: the icon
 * turns into a check for a moment, or into a warning when the browser
 * refuses (no clipboard permission, an insecure page), and the tooltip reads
 * "Copied" or "Copy failed" and stays open for that moment even if the
 * pointer has left (T3 Code's copy feedback). UI state only.
 */
export function AssistantCopyButton({ text, label = 'Copy message' }: { text: string; label?: string }) {
  const [outcome, setOutcome] = useState<CopyOutcome>('idle');
  const [hovered, setHovered] = useState(false);
  const show = (next: Exclude<CopyOutcome, 'idle'>) => {
    setOutcome(next);
    setTimeout(() => setOutcome('idle'), 1200);
  };
  return (
    <Tooltip open={hovered || outcome !== 'idle'} onOpenChange={setHovered}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-assistant-dim hover:text-foreground"
          aria-label={outcome === 'idle' ? label : OUTCOME_LABEL[outcome]}
          onClick={() => {
            // Inside the chain so a missing `navigator.clipboard` also lands in the catch.
            void Promise.resolve()
              .then(() => navigator.clipboard.writeText(text))
              .then(() => show('copied'))
              .catch(() => show('failed'));
          }}
        >
          {outcome === 'copied' ? <Check /> : outcome === 'failed' ? <AlertCircle className="text-destructive" /> : <Copy />}
        </Button>
      </TooltipTrigger>
      {/* Below the button: above it, the tooltip would cover the message it copies. */}
      <TooltipContent side="bottom">{outcome === 'idle' ? 'Copy' : OUTCOME_LABEL[outcome]}</TooltipContent>
    </Tooltip>
  );
}

import { Button } from '@campuspilot/ui/components/button';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/** Copies text; the icon turns into a check for a moment (UI state only). */
export function AssistantCopyButton({ text, label = 'Copy message' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="text-assistant-dim hover:text-foreground"
      aria-label={copied ? 'Copied' : label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}

import { Button } from '@campuspilot/ui/components/button';
import { FileText, X } from 'lucide-react';

/**
 * What a conversation was started from ("Continue in chat" on a question
 * paper), as a removable chip at the top of the message box. Removing it
 * starts a plain conversation instead; nothing is sent either way until the
 * user sends.
 */
export function AssistantContextChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 py-2 text-xs">
      <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-foreground" title={label}>
        {label}
      </span>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove context" className="-me-1.5 size-6 text-muted-foreground" onClick={onRemove}>
        <X />
      </Button>
    </div>
  );
}

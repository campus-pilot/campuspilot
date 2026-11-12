import { Button } from '@campuspilot/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@campuspilot/ui/components/collapsible';
import { ChevronDown } from 'lucide-react';

import { placeholderNote, removedSummary } from './paper-notices-model';

/**
 * What the sanitiser took out of a paper's HTML (a style, attribute or element
 * the print template does not accept), behind a collapsed list. Nothing here
 * blocks the paper: it is printed without those parts, and the list lets a
 * teacher see why a line looks plainer than the photo.
 */
export function RemovedList({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <Collapsible className="flex flex-col gap-1">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="self-start text-muted-foreground">
          {removedSummary(lines.length)}
          <ChevronDown data-icon="inline-end" aria-hidden />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul aria-label="Notices" className="flex list-disc flex-col gap-1 pl-8 text-sm text-muted-foreground">
          {lines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The sentence for figures still drawn as a labelled box, or nothing when there are none. */
export function PlaceholderNote({ count }: { count: number }) {
  const note = placeholderNote(count);
  return note ? <p className="text-sm text-muted-foreground">{note}</p> : null;
}

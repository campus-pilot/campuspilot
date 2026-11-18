'use client';

import { CommandGroup, CommandItem, CommandShortcut } from '@campuspilot/ui/components/command';
import { LoaderCircle, RotateCcw } from 'lucide-react';

/** The look of every command palette row. */
export const paletteItemClassName =
  'my-0.5 min-h-10 cursor-pointer gap-2.5 rounded-lg border border-transparent px-2 py-1.5 transition-colors data-selected:border-border data-selected:bg-muted/70';

/** A palette group holding one status row: loading (disabled), or a failed read with a retry. */
export function ProviderStatus({
  heading,
  label,
  retry,
}: {
  heading: string;
  label: string;
  retry?: () => void;
}) {
  return (
    <CommandGroup heading={heading}>
      <CommandItem
        className={paletteItemClassName}
        value={`provider:${heading}:${label}`}
        disabled={!retry}
        onSelect={retry}
      >
        {retry ? (
          <RotateCcw className="size-4" aria-hidden />
        ) : (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        )}
        <span className="min-w-0 flex-1 text-muted-foreground">{label}</span>
        {retry ? (
          <CommandShortcut className="hidden sm:inline">Retry</CommandShortcut>
        ) : null}
      </CommandItem>
    </CommandGroup>
  );
}

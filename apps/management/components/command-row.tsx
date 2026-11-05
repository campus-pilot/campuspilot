import { CommandShortcut } from '@campuspilot/ui/components/command';
import { ChevronRight } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** A command palette row: muted icon, label with one line of detail, chevron. */
export function CommandRow({
  icon: Icon,
  label,
  description,
}: {
  icon: Icon;
  label: string;
  description: string;
}) {
  return (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-colors group-data-selected/command-item:text-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {description}
        </span>
      </span>
      <CommandShortcut className="flex">
        <ChevronRight className="size-3.5" aria-hidden />
      </CommandShortcut>
    </>
  );
}

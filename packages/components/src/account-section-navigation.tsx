'use client';

import { Button } from '@campuspilot/ui/components/button';
import type { LucideIcon } from 'lucide-react';

export type AccountSection<Id extends string> = {
  id: Id;
  label: string;
  icon: LucideIcon;
};

/**
 * Section switcher for the account dialogs: a scrollable row on small screens
 * and a left column from `md` up.
 */
export function AccountSectionNavigation<Id extends string>({
  sections,
  activeSection,
  onChange,
}: {
  sections: readonly AccountSection<Id>[];
  activeSection: Id;
  onChange: (section: Id) => void;
}) {
  return (
    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 md:w-44 md:flex-col md:border-r md:border-b-0 md:p-3">
      {sections.map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          type="button"
          variant={activeSection === id ? 'secondary' : 'ghost'}
          aria-current={activeSection === id ? 'page' : undefined}
          className="shrink-0 justify-start rounded-lg"
          onClick={() => onChange(id)}
        >
          <Icon />
          {label}
        </Button>
      ))}
    </nav>
  );
}

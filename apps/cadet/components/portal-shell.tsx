import type { ReactNode } from 'react';
import { ThemeToggle } from '@campuspilot/components/theme-toggle';

/**
 * Centered single-column frame shared by the Cadet Portal's pages. `narrow`
 * (forms, home) is vertically centred; `wide` (lists such as the inbox)
 * starts at the top.
 */
export function PortalShell({ children, width = 'narrow' }: { children: ReactNode; width?: 'narrow' | 'wide' }) {
  return (
    <main className={`relative flex min-h-svh justify-center bg-background px-4 py-16 text-foreground sm:px-6 ${width === 'narrow' ? 'items-center' : 'items-start'}`}>
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>
      <div className={`w-full ${width === 'narrow' ? 'max-w-sm' : 'max-w-2xl'}`}>{children}</div>
    </main>
  );
}

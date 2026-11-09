import type { ReactNode } from 'react';
import { ThemeToggle } from '@campuspilot/components/theme-toggle';

/** Centered single-column frame shared by the Cadet Portal's pages. */
export function PortalShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-svh items-center justify-center bg-background px-4 py-16 text-foreground sm:px-6">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}

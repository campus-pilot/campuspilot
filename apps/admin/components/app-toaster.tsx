'use client';

import { Toaster } from '@campuspilot/ui/components/sonner';

/**
 * Client boundary for the shared Sonner toaster (it reads the theme through a
 * client hook). Mounted in the root layout inside the query provider, so
 * toast bodies can follow live queries.
 */
export function AppToaster() {
  return <Toaster position="bottom-right" />;
}

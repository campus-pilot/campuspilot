'use client';

import { Toaster } from '@campuspilot/ui/components/sonner';

/** Keeps mutation confirmations visible when a successful action navigates or closes its editor. */
export function ExamNotifications() {
  return <Toaster position="top-center" />;
}

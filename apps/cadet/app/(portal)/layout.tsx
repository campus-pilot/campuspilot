import type { ReactNode } from 'react';
import { AppFrame } from '@/components/app-frame';

/** Every signed-in screen shares the phone frame, top bar and bottom navigation. */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}

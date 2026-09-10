import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@campuspilot/ui/components/tooltip';
import './globals.css';

export const metadata: Metadata = {
  title: 'Management',
  description: 'CampusPilot management application',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}

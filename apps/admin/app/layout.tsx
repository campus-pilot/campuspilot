import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@campuspilot/components/theme-provider';
import { TooltipProvider } from '@campuspilot/ui/components/tooltip';
import './globals.css';

export const metadata: Metadata = {
  title: 'admin',
  description: 'CampusPilot admin application',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

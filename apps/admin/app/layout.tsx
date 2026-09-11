import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@campuspilot/components/theme-provider';
import { TooltipProvider } from '@campuspilot/ui/components/tooltip';
import { QueryProvider } from '@/components/query-provider';
import './globals.css';
import { Inter } from "next/font/google";
import { cn } from "@campuspilot/ui/lib/utils";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'admin',
  description: 'CampusPilot admin application',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("font-sans", inter.variable)}>
      <body>
        <QueryProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <TooltipProvider>{children}</TooltipProvider>
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@campuspilot/components/theme-provider';
import { QueryProvider } from '@/components/query-provider';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  applicationName: 'Cadet Portal',
  title: {
    default: 'Cadet Portal',
    template: '%s | Cadet Portal',
  },
  description: 'Your CampusPilot student portal.',
};

export const viewport: Viewport = {
  themeColor: '#c2580e',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} font-sans`}
    >
      <body className="min-h-screen bg-background antialiased">
        <QueryProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}

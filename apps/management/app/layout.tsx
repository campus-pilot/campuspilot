import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { ThemeColorMeta } from '@campuspilot/components/theme-color-meta';
import { ThemeProvider } from '@campuspilot/components/theme-provider';
import { TooltipProvider } from '@campuspilot/ui/components/tooltip';
import { ExamNotifications } from '@/components/exam/exam-notifications';
import { QueryProvider } from '@/components/query-provider';
import { DEFAULT_APP_ICONS } from '@/components/app-icons';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  applicationName: 'CampusPilot Management',
  title: {
    default: 'CampusPilot Management',
    template: '%s | CampusPilot',
  },
  description: 'Run your school from one secure CampusPilot workspace.',
  icons: DEFAULT_APP_ICONS,
  appleWebApp: {
    capable: true,
    title: 'CampusPilot',
    statusBarStyle: 'default',
  },
};

/**
 * Bar colors for the browser and the installed app, matching `--background`
 * in `@campuspilot/ui` globals.css (light `oklch(1 0 0)`, dark
 * `oklch(0.141 0.005 285.823)`). `ThemeColorMeta` picks one from the app's
 * light/dark setting; no static `viewport.themeColor` is set, because a
 * second theme-color tag would win over the dynamic one.
 */
const THEME_COLORS = { light: '#ffffff', dark: '#09090b' };

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
            <ThemeColorMeta {...THEME_COLORS} />
            <TooltipProvider>
              {children}
              <ExamNotifications />
            </TooltipProvider>
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}

'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChartLineIcon, GraduationCapIcon, HouseIcon, MenuIcon, WalletIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@campuspilot/ui/components/avatar';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { cn } from '@campuspilot/ui/lib/utils';

import { authClient } from '@/lib/auth-client';
import { initialsOf } from '@/lib/format';
import { orpc } from '@/lib/orpc';
import { currentEnrollment } from '@/lib/profile';
import { ScreenLoading } from './screen';

const tabs = [
  { href: '/', label: 'Home', icon: HouseIcon },
  { href: '/fees', label: 'Fees', icon: WalletIcon },
  { href: '/results', label: 'Results', icon: GraduationCapIcon },
  { href: '/growth', label: 'Growth', icon: ChartLineIcon },
  { href: '/more', label: 'More', icon: MenuIcon },
] as const;

/** A tab is active on its own route and any route nested under it; Home only matches exactly. */
export function isTabActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** Whose records are shown: the student, their class and school. */
function TopBar() {
  const profile = useQuery(orpc.getProfile.queryOptions());
  const enrollment = profile.data ? currentEnrollment(profile.data) : null;
  const detail = profile.data
    ? [enrollment?.classLabel, enrollment?.sectionLabel, profile.data.schoolName].filter(Boolean).join(' · ')
    : null;
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background/90 px-4 py-2.5 backdrop-blur">
      <Avatar>
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
          {profile.data ? initialsOf(profile.data.name) : null}
        </AvatarFallback>
      </Avatar>
      {profile.data ? (
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold leading-tight">{profile.data.name}</span>
          <span className="truncate text-xs text-muted-foreground">{detail}</span>
        </div>
      ) : (
        <Skeleton className="h-8 flex-1" />
      )}
    </header>
  );
}

/** Thumb-reachable primary navigation; 56px tall so every target clears the 44px touch minimum. */
function BottomNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="sticky bottom-0 z-20 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {tabs.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={isTabActive(pathname, href) ? 'page' : undefined}
              className={cn(
                'flex h-14 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-muted-foreground',
                isTabActive(pathname, href) && 'text-primary',
              )}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * One layout for every screen size. On phones the app fills the screen and
 * the document scrolls. From `md` up the same app sits in a centred,
 * phone-sized frame that scrolls internally, so the top bar and bottom nav
 * stay inside the frame and there is no separate desktop design.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-muted/40 text-foreground md:flex md:items-center md:justify-center md:p-6">
      <div className="mx-auto flex min-h-svh max-w-md flex-col bg-background md:h-[min(56rem,calc(100svh-3rem))] md:min-h-0 md:w-[26rem] md:overflow-hidden md:rounded-[2rem] md:border md:shadow-2xl">
        {children}
      </div>
    </div>
  );
}

/**
 * The signed-in portal. Who the student is comes from the cadet session;
 * signed-out visitors go to sign-in before any record is requested.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  if (!isPending && !session) redirect('/sign-in');
  return (
    <Frame>
      {session ? <TopBar /> : null}
      <main className="flex flex-1 flex-col gap-5 px-4 pb-6 pt-4 md:min-h-0 md:overflow-y-auto md:*:shrink-0">
        {session ? children : <ScreenLoading />}
      </main>
      <BottomNav />
    </Frame>
  );
}

'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChartLineIcon, GraduationCapIcon, HouseIcon, MenuIcon, SchoolIcon, WalletIcon } from 'lucide-react';
import { readSchoolFeatureDisabled } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import { Avatar, AvatarFallback } from '@campuspilot/ui/components/avatar';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { cn } from '@campuspilot/ui/lib/utils';

import { authClient } from '@/lib/auth-client';
import { initialsOf } from '@/lib/format';
import { orpc } from '@/lib/orpc';
import { NOTICES_HREF } from '@/lib/route-param';
import { CadetSchoolChrome } from './cadet-school-chrome';
import { SignOutButton } from './more/more-screen';
import { CadetNotificationBell } from './notifications/cadet-notifications';
import { EmptyState, ScreenLoading } from './screen';

/**
 * The five tabs. `sections`: screens outside a tab's own route that belong
 * to it: Notices has no tab of its own (the bar keeps five) and is listed
 * under More, so More is highlighted there, also when a student arrives
 * from a notification.
 */
const tabs: readonly { href: string; label: string; icon: typeof HouseIcon; sections?: readonly string[] }[] = [
  { href: '/', label: 'Home', icon: HouseIcon },
  { href: '/fees', label: 'Fees', icon: WalletIcon },
  { href: '/results', label: 'Results', icon: GraduationCapIcon },
  { href: '/growth', label: 'Growth', icon: ChartLineIcon },
  { href: '/more', label: 'More', icon: MenuIcon, sections: [NOTICES_HREF] },
];

function isUnder(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** A tab is active on its own route, its `sections` and any route nested under them; Home only matches exactly. */
export function isTabActive(pathname: string, href: string, sections: readonly string[] = []) {
  if (href === '/') return pathname === '/';
  return isUnder(pathname, href) || sections.some((section) => isUnder(pathname, section));
}

/** Whose records are shown (the student, their class and school) and their notification bell. */
function TopBar() {
  const profile = useQuery(orpc.getProfile.queryOptions());
  const enrollment = profile.data?.current ?? null;
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
      <CadetNotificationBell />
    </header>
  );
}

/** Thumb-reachable primary navigation; 56px tall so every target clears the 44px touch minimum. */
function BottomNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="sticky bottom-0 z-20 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {tabs.map(({ href, label, icon: Icon, sections }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={isTabActive(pathname, href, sections) ? 'page' : undefined}
              className={cn(
                'flex h-14 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-muted-foreground',
                isTabActive(pathname, href, sections) && 'text-primary',
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
 * Shown instead of the portal when the student's school has the Cadet Portal
 * switched off (the `cadet` feature flag). The session is still valid, so
 * this is not a sign-in problem: the student is told to ask the school and
 * can sign out. No tabs are drawn, because every screen would be refused.
 */
function PortalUnavailable() {
  return (
    <main className="flex flex-1 flex-col justify-center gap-5 px-4 py-6">
      <EmptyState
        icon={SchoolIcon}
        title="Cadet Portal unavailable"
        description="Your school is not using the Cadet Portal right now. Please ask your school office for help."
      />
      <SignOutButton />
    </main>
  );
}

/** The portal chrome around a screen: install chrome, top bar, content, tabs. */
function PortalChrome({ children }: { children: ReactNode }) {
  return (
    <>
      <CadetSchoolChrome />
      <TopBar />
      <main className="flex flex-1 flex-col gap-5 px-4 pb-6 pt-4 md:min-h-0 md:overflow-y-auto md:*:shrink-0">
        {children}
      </main>
      <BottomNav />
    </>
  );
}

/**
 * The signed-in portal, or the "unavailable" screen when the server answers
 * the profile read (the one read every screen shares, through the top bar)
 * with the feature-disabled error for `cadet`. Any other failure is left to
 * the screens' own error states.
 */
function SignedInPortal({ children }: { children: ReactNode }) {
  const profile = useQuery(orpc.getProfile.queryOptions());
  if (readSchoolFeatureDisabled(profile.error) === 'cadet') return <PortalUnavailable />;
  return <PortalChrome>{children}</PortalChrome>;
}

/** What a visitor sees while the session is being resolved (or before the redirect). */
function ResolvingSession() {
  return (
    <>
      <main className="flex flex-1 flex-col gap-5 px-4 pb-6 pt-4 md:min-h-0 md:overflow-y-auto md:*:shrink-0">
        <ScreenLoading />
      </main>
      <BottomNav />
    </>
  );
}

/**
 * The signed-in portal. Who the student is comes from the cadet session;
 * signed-out visitors go to sign-in before any record is requested. Signed-in
 * pages also carry the school's install chrome (manifest, icon, install
 * invitation), which needs the school and so never renders before sign-in.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  if (!isPending && !session) redirect('/sign-in');
  return <Frame>{session ? <SignedInPortal>{children}</SignedInPortal> : <ResolvingSession />}</Frame>;
}

'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BellIcon, ChartLineIcon, GraduationCapIcon, HouseIcon, MenuIcon, WalletIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@campuspilot/ui/components/avatar';
import { Button } from '@campuspilot/ui/components/button';
import { cn } from '@campuspilot/ui/lib/utils';

import { student } from './mock-data';

const tabs = [
  { href: '/concept', label: 'Home', icon: HouseIcon },
  { href: '/concept/fees', label: 'Fees', icon: WalletIcon },
  { href: '/concept/results', label: 'Results', icon: GraduationCapIcon },
  { href: '/concept/growth', label: 'Growth', icon: ChartLineIcon },
  { href: '/concept/more', label: 'More', icon: MenuIcon },
] as const;

/** A tab is active on its own route and any route nested under it; Home only matches exactly. */
function isActive(pathname: string, href: string) {
  return href === '/concept' ? pathname === href : pathname.startsWith(href);
}

/** Sticky top bar: whose data is shown (the student) and the notification entry point. */
function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background/90 px-4 py-2.5 backdrop-blur">
      <Avatar>
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{student.initials}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold leading-tight">{student.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {student.className} · {student.section} · {student.school}
        </span>
      </div>
      <Button asChild variant="ghost" size="icon-lg" aria-label="Notifications">
        <Link href="/concept/updates" className="relative">
          <BellIcon />
          <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-background" />
        </Link>
      </Button>
    </header>
  );
}

/** Thumb-reachable primary navigation, pinned to the bottom of the viewport; 56px tall so every target clears the 44px touch minimum. */
function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="sticky bottom-0 z-20 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {tabs.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className={cn(
                'flex h-14 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-muted-foreground',
                isActive(pathname, href) && 'text-primary',
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
 * stay inside the frame and there is no separate desktop design to maintain.
 */
export function ConceptShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-muted/40 text-foreground md:flex md:items-center md:justify-center md:p-6">
      <div className="mx-auto flex min-h-svh max-w-md flex-col bg-background md:h-[min(56rem,calc(100svh-3rem))] md:min-h-0 md:w-[26rem] md:overflow-hidden md:rounded-[2rem] md:border md:shadow-2xl">
        <TopBar />
        <main className="flex flex-1 flex-col gap-5 px-4 pb-6 pt-4 md:min-h-0 md:overflow-y-auto md:*:shrink-0">{children}</main>
        <BottomNav />
      </div>
    </div>
  );
}

/** Screen heading with an optional trailing action. */
export function ScreenHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Small uppercase label above a group of rows. */
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>
      {action}
    </div>
  );
}

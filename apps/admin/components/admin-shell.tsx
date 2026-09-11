'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AppShell,
  type AppShellBreadcrumb,
  type AppShellNavigationGroup,
} from '@campuspilot/components/app-shell';
import { Button } from '@campuspilot/ui/components/button';
import {
  Building2,
  CalendarDays,
  Command,
  CreditCard,
  GraduationCap,
  LayoutGrid,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { AdminAccountDialog } from './admin-account-dialog';
import { SchoolSwitcher } from './school-switcher';

const navigation: AppShellNavigationGroup[] = [
  {
    id: 'general',
    label: 'General',
    items: [
      { id: 'home', label: 'Home', href: '/', icon: LayoutGrid },
      { id: 'calendar', label: 'Calendar', href: '/calendar', icon: CalendarDays },
      { id: 'people', label: 'People', href: '/people', icon: Users },
    ],
  },
  {
    id: 'departments',
    label: 'Departments',
    items: [
      {
        id: 'administration',
        label: 'Administration',
        href: '/departments/administration',
        icon: Building2,
        items: [
          {
            id: 'administration-overview',
            label: 'Overview',
            href: '/departments/administration',
            icon: LayoutGrid,
          },
          {
            id: 'administration-people',
            label: 'People',
            href: '/departments/administration/people',
            icon: Users,
          },
        ],
      },
      { id: 'finances', label: 'Finances', href: '/departments/finances', icon: CreditCard },
      { id: 'classroom', label: 'Classroom', href: '/departments/classroom', icon: GraduationCap },
    ],
  },
];

const routeBreadcrumbs: Record<string, AppShellBreadcrumb[]> = {
  '/': [
    { id: 'campuspilot', label: 'CampusPilot' },
    { id: 'home', label: 'Home' },
  ],
  '/dashboard': [
    { id: 'campuspilot', label: 'CampusPilot', href: '/' },
    { id: 'dashboard', label: 'Dashboard' },
  ],
};

function breadcrumbsFor(pathname: string): AppShellBreadcrumb[] {
  const registered = routeBreadcrumbs[pathname];
  if (registered) return registered;

  const segments = pathname.split('/').filter(Boolean);
  return [
    { id: 'campuspilot', label: 'CampusPilot', href: '/' },
    ...segments.map((segment, index) => ({
      id: segments.slice(0, index + 1).join('-'),
      label: segment.replaceAll('-', ' ').replace(/^./, (letter) => letter.toUpperCase()),
      href: index < segments.length - 1 ? `/${segments.slice(0, index + 1).join('/')}` : undefined,
    })),
  ];
}

function AdminSearch() {
  return (
    <Button variant="ghost" className="justify-start rounded-lg px-2">
      <Search />
      Search
      <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
        <Command className="size-3" />K
      </span>
    </Button>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const [isAccountDialogOpen, setIsAccountDialogOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();

  async function logout() {
    await authClient.signOut();
    router.replace('/sign-in');
  }

  const user = {
    name: session?.user.name ?? 'CampusPilot admin',
    secondaryLabel: session?.user.email ?? 'Administrator',
    avatarUrl: session?.user.image,
  };

  return (
    <>
      <AppShell
      currentPath={pathname}
      navigation={navigation}
      breadcrumbs={breadcrumbsFor(pathname)}
      sidebarHeader={<SchoolSwitcher />}
      search={<AdminSearch />}
      user={user}
      navbarActions={
        <Button variant="outline" size="sm" className="rounded-lg">
          <Plus />
          Quick add
        </Button>
      }
      onManageAccount={() => setIsAccountDialogOpen(true)}
      onLogout={logout}
      renderLink={({ href, children: linkChildren, className }) => (
        <Link href={href} className={className}>
          {linkChildren}
        </Link>
      )}
      >
        {children}
      </AppShell>
      <AdminAccountDialog
        open={isAccountDialogOpen}
        onOpenChange={setIsAccountDialogOpen}
        name={user.name}
        email={user.secondaryLabel}
      />
    </>
  );
}

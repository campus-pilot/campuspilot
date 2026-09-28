'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AppShell,
  type AppShellBreadcrumb,
  type AppShellFooterLink,
  type AppShellNavigationEntry,
} from '@campuspilot/components/app-shell';
import { getProfileImageUrl } from '@campuspilot/auth/profile-image.client';
import { env } from '@campuspilot/env/management.client';
import { Button } from '@campuspilot/ui/components/button';
import { Command, Search } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { AccountDialog } from './account-dialog';
import { SchoolSwitcher } from './school-switcher';

export type ManagementShellState = {
  navigation: AppShellNavigationEntry[];
  breadcrumbs: AppShellBreadcrumb[];
  footerLinks?: AppShellFooterLink[];
  footerContent?: ReactNode;
  navbarActions?: ReactNode;
};

function SchoolSearch() {
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

export function ManagementShell({
  children,
  state,
  showSearch = true,
}: {
  children: ReactNode;
  state: ManagementShellState;
  showSearch?: boolean;
}) {
  const [isAccountDialogOpen, setIsAccountDialogOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();

  async function logout() {
    await authClient.signOut();
    router.replace('/auth/login');
  }

  const user = {
    name: session?.user.name ?? 'CampusPilot user',
    secondaryLabel: session?.user.email ?? 'School workspace',
    avatarUrl: getProfileImageUrl(
      env.NEXT_PUBLIC_SERVER_URL,
      session?.user.profileImageS3Key,
    ),
  };

  return (
    <>
      <AppShell
        currentPath={pathname}
        navigation={state.navigation}
        breadcrumbs={state.breadcrumbs}
        sidebarHeader={<SchoolSwitcher />}
        search={showSearch ? <SchoolSearch /> : null}
        user={user}
        footerLinks={state.footerLinks}
        footerContent={state.footerContent}
        navbarActions={state.navbarActions}
        onManageAccount={() => setIsAccountDialogOpen(true)}
        onLogout={logout}
        renderLink={({
          href,
          children: linkChildren,
          className,
          ariaCurrent,
          onClick,
        }) => (
          <Link
            href={href}
            className={className}
            aria-current={ariaCurrent}
            onClick={onClick}
          >
            {linkChildren}
          </Link>
        )}
      >
        {children}
      </AppShell>
      {isAccountDialogOpen ? (
        <AccountDialog
          open
          onOpenChange={setIsAccountDialogOpen}
          name={user.name}
          email={user.secondaryLabel}
        />
      ) : null}
    </>
  );
}

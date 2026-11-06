'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AppShell,
  type AppShellBreadcrumb,
  type AppShellNavigationEntry,
} from '@campuspilot/components/app-shell';
import { getProfileImageUrl } from '@campuspilot/auth/profile-image.client';
import { env } from '@campuspilot/env/admin.client';
import { authClient } from '@/lib/auth-client';
import { AdminAccountDialog } from './admin-account-dialog';
import { SchoolSwitcher } from './school-switcher';

export type AdminShellState = {
  navigation: AppShellNavigationEntry[];
  breadcrumbs: AppShellBreadcrumb[];
  navbarActions?: ReactNode;
};

export function AdminShell({
  children,
  state,
}: {
  children: ReactNode;
  state: AdminShellState;
}) {
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
        search={null}
        user={user}
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
      <AdminAccountDialog
        open={isAccountDialogOpen}
        onOpenChange={setIsAccountDialogOpen}
        name={user.name}
        email={user.secondaryLabel}
      />
    </>
  );
}

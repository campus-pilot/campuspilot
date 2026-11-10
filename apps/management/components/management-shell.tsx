'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { SchoolSessionDto } from '@campuspilot/api/routers/school/session/session.dto';
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
import { useInstallApp } from '@/lib/install-app.client';
import { AccountDialog } from './account-dialog';
import { forgetDrafts } from './assistant/assistant-draft';
import { AssistantPanel } from './assistant/assistant-panel';
import { ManagementCommandPalette } from './management-command-palette';
import { commandPaletteContextKey } from './management-command-model';
import { SchoolSwitcher } from './school-switcher';

export type ManagementShellState = {
  navigation: AppShellNavigationEntry[];
  breadcrumbs: AppShellBreadcrumb[];
  footerLinks?: AppShellFooterLink[];
  footerContent?: ReactNode;
  navbarActions?: ReactNode;
  commandContext: {
    schoolId: string;
    sessionId?: string;
    sessions: SchoolSessionDto[];
  };
};

function SchoolSearch({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="justify-start rounded-lg px-2"
      onClick={onClick}
    >
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
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const { isInstallAvailable, installApp } = useInstallApp();

  /** The global shortcut is the one approved lifecycle listener for this feature. */
  useEffect(() => {
    if (!showSearch) return;
    const openPalette = (event: KeyboardEvent) => {
      if (
        !event.defaultPrevented &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLocaleLowerCase() === 'k'
      ) {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', openPalette);
    return () => window.removeEventListener('keydown', openPalette);
  }, [showSearch]);

  async function logout() {
    await authClient.signOut();
    forgetDrafts();
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
        search={
          showSearch ? (
            <SchoolSearch onClick={() => setIsCommandPaletteOpen(true)} />
          ) : null
        }
        user={user}
        footerLinks={state.footerLinks}
        footerContent={state.footerContent}
        navbarActions={state.navbarActions}
        navbarSearch={
          showSearch ? (
            <>
              <AssistantPanel schoolId={state.commandContext.schoolId} />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Search actions and students"
                onClick={() => setIsCommandPaletteOpen(true)}
              >
                <Search aria-hidden />
              </Button>
            </>
          ) : null
        }
        onManageAccount={() => setIsAccountDialogOpen(true)}
        isInstallAvailable={isInstallAvailable}
        onInstallApp={installApp}
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
      {showSearch ? (
        <ManagementCommandPalette
          key={commandPaletteContextKey(
            state.commandContext.schoolId,
            state.commandContext.sessionId,
          )}
          open={isCommandPaletteOpen}
          onOpenChange={setIsCommandPaletteOpen}
          schoolId={state.commandContext.schoolId}
          sessionId={state.commandContext.sessionId}
          sessions={state.commandContext.sessions}
          onNavigate={router.push}
        />
      ) : null}
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

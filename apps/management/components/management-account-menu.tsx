'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShellUserMenu } from '@campuspilot/components/app-shell';
import { getProfileImageUrl } from '@campuspilot/auth/profile-image.client';
import { env } from '@campuspilot/env/management.client';
import { authClient } from '@/lib/auth-client';
import { AccountDialog } from './account-dialog';

/** Reuses the shell account actions with a compact navbar avatar trigger. */
export function ManagementAccountMenu() {
  const [isAccountDialogOpen, setIsAccountDialogOpen] = useState(false);
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const user = {
    name: session?.user.name ?? 'CampusPilot user',
    secondaryLabel: session?.user.email ?? 'School workspace',
    avatarUrl: getProfileImageUrl(
      env.NEXT_PUBLIC_SERVER_URL,
      session?.user.profileImageS3Key,
    ),
  };

  async function logout() {
    await authClient.signOut();
    router.replace('/auth/login');
  }

  return (
    <>
      <AppShellUserMenu
        trigger="avatar"
        user={user}
        onManageAccount={() => setIsAccountDialogOpen(true)}
        onLogout={logout}
      />
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

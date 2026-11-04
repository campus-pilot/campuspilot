import { AppWindow, KeyRound } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';
import { NewOAuthClientAction } from '@/components/new-oauth-client-action';

export const oauthClientsPage = defineAdminPage<Record<string, never>>({
  matches: (pathname) => pathname === '/oauth-clients',
  breadcrumbs: () => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    { id: 'oauth-clients', label: 'OAuth clients', icon: KeyRound },
  ],
  actions: () => <NewOAuthClientAction />,
});

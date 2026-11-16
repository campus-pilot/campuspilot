import { AppWindow, UsersRound } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';

export const usersPage = defineAdminPage<Record<string, never>>({
  matches: (pathname) => pathname === '/users',
  breadcrumbs: () => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    { id: 'users', label: 'Users', icon: UsersRound },
  ],
});

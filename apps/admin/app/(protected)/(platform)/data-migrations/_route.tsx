import { AppWindow, DatabaseZap } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';

export const dataMigrationsPage = defineAdminPage<Record<string, never>>({
  matches: (pathname) => pathname === '/data-migrations',
  breadcrumbs: () => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    { id: 'data-migrations', label: 'Data migrations', icon: DatabaseZap },
  ],
});

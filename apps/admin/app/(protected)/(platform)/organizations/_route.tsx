import { AppWindow, Building2 } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';

export const organizationsPage = defineAdminPage<Record<string, never>>({
  matches: (pathname) => pathname === '/organizations',
  breadcrumbs: () => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    { id: 'organizations', label: 'Organizations', icon: Building2 },
  ],
});

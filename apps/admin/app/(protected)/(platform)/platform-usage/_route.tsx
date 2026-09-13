import { AppWindow, ChartNoAxesColumn } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';

export const platformUsagePage = defineAdminPage<Record<string, never>>({
  matches: (pathname) => pathname === '/platform-usage',
  breadcrumbs: () => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    { id: 'platform-usage', label: 'Platform Usage', icon: ChartNoAxesColumn },
  ],
});

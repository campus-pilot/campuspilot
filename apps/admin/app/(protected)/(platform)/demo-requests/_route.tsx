import { AppWindow, ClipboardList } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';

export const demoRequestsPage = defineAdminPage<Record<string, never>>({
  matches: (pathname) => pathname === '/demo-requests',
  breadcrumbs: () => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    { id: 'demo-requests', label: 'Demo requests', icon: ClipboardList },
  ],
});

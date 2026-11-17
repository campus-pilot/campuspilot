import { AppWindow, SchoolIcon } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';

export const schoolRequestsPage = defineAdminPage<Record<string, never>>({
  matches: (pathname) => pathname === '/school-requests',
  breadcrumbs: () => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    { id: 'school-requests', label: 'School requests', icon: SchoolIcon },
  ],
});

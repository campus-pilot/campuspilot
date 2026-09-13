import { AppWindow, House } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';

export const homePage = defineAdminPage<Record<string, never>>({
  matches: (pathname) => pathname === '/',
  breadcrumbs: () => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    { id: 'home', label: 'Home', icon: House },
  ],
});

import { AppWindow, ClipboardPen, SchoolIcon } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';

export const schoolSetupPage = defineAdminPage<Record<string, never>>({
  matches: (pathname) => /^\/school-onboarding\/[^/]+\/setup$/.test(pathname),
  breadcrumbs: () => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    { id: 'school-onboarding', label: 'School onboarding', href: '/school-onboarding', icon: ClipboardPen },
    { id: 'school-setup', label: 'Set up school', icon: SchoolIcon },
  ],
});

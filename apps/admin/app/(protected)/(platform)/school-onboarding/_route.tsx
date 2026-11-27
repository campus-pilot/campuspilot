import { AppWindow, ClipboardPen } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';

export const schoolOnboardingPage = defineAdminPage<Record<string, never>>({
  matches: (pathname) => pathname === '/school-onboarding',
  breadcrumbs: () => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    { id: 'school-onboarding', label: 'School onboarding', icon: ClipboardPen },
  ],
});

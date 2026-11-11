import { AppWindow, Receipt } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';

export const aiBillingPage = defineAdminPage<Record<string, never>>({
  matches: (pathname) => pathname === '/ai-billing',
  breadcrumbs: () => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    { id: 'ai-billing', label: 'AI billing', icon: Receipt },
  ],
});

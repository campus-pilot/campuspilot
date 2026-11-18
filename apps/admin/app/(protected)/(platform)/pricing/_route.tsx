import { AppWindow, IndianRupee } from 'lucide-react';
import { defineAdminPage } from '@/components/admin-route';

export const pricingPage = defineAdminPage<Record<string, never>>({
  matches: (pathname) => pathname === '/pricing',
  breadcrumbs: () => [
    { id: 'campuspilot', label: 'CampusPilot', href: '/', icon: AppWindow },
    { id: 'pricing', label: 'Pricing', icon: IndianRupee },
  ],
});

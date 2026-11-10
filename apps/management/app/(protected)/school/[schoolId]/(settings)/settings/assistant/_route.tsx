import { Sparkles } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import type { SchoolRouteParams } from '@/components/school-route';
import { settingsBreadcrumbs } from '../settings-breadcrumbs';

export const assistantSettingsPage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/settings\/assistant$/.test(pathname),
  title: 'AI assistant',
  breadcrumbs: ({ schoolId }) => settingsBreadcrumbs(schoolId, { id: 'assistant-settings', label: 'AI assistant', icon: Sparkles }),
});

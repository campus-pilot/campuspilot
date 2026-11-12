import { FileQuestionMark } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import type { SchoolRouteParams } from '@/components/school-route';
import { settingsBreadcrumbs } from '../../settings-breadcrumbs';

export const questionPaperTemplatePage = defineManagementPage<SchoolRouteParams>({
  matches: (pathname) => /^\/school\/[^/]+\/settings\/templates\/question-paper$/.test(pathname),
  title: 'Question paper template',
  breadcrumbs: ({ schoolId }) =>
    settingsBreadcrumbs(schoolId, { id: 'question-paper-template', label: 'Question paper', icon: FileQuestionMark }),
});

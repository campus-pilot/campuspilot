import { Megaphone } from 'lucide-react';
import { defineManagementPage } from '@/components/management-route';
import { NewNoticeAction } from '@/components/notices/notice-list';
import { noticesHref } from '@/components/notices/notice-model';
import { NoticeBreadcrumbValue } from '@/components/notices/notice-workspace';
import { noticeHref } from '@/components/notifications/notification-routes';
import { sessionPageBreadcrumbs } from '@/components/session-page-breadcrumbs';
import type { SchoolSessionRouteParams } from '@/components/school-route';

type NoticeRouteParams = SchoolSessionRouteParams & { noticeId: string };

/** Session crumbs with "Notices" linking back to the list, for the pages beneath it. */
function noticesTrail({ schoolId, sessionId }: SchoolSessionRouteParams) {
  return sessionPageBreadcrumbs(schoolId, sessionId, { id: 'notices', label: 'Notices', icon: Megaphone }).map((breadcrumb) =>
    breadcrumb.id === 'notices' ? { ...breadcrumb, href: noticesHref({ schoolId, sessionId }) } : breadcrumb,
  );
}

export const noticesPage = defineManagementPage<SchoolSessionRouteParams>({
  matches: (pathname) =>
    /^\/school\/[^/]+\/sessions\/[^/]+\/notices$/.test(pathname),
  title: 'Notices',
  breadcrumbs: ({ schoolId, sessionId }) =>
    sessionPageBreadcrumbs(schoolId, sessionId, { id: 'notices', label: 'Notices', icon: Megaphone }),
  actions: ({ schoolId, sessionId }) => <NewNoticeAction scope={{ schoolId, sessionId }} />,
});

export const newNoticePage = defineManagementPage<SchoolSessionRouteParams>({
  matches: (pathname) =>
    /^\/school\/[^/]+\/sessions\/[^/]+\/notices\/new$/.test(pathname),
  title: 'New notice',
  breadcrumbs: (params) => [...noticesTrail(params), { id: 'notice-new', label: 'New notice' }],
});

/** The notice page; the breadcrumb resolves the notice's title. */
export const noticeDetailsPage = defineManagementPage<NoticeRouteParams>({
  matches: (pathname) =>
    /^\/school\/[^/]+\/sessions\/[^/]+\/notices\/[^/]+$/.test(pathname),
  title: 'Notice',
  breadcrumbs: ({ noticeId, ...params }) => [
    ...noticesTrail(params),
    { id: 'notice-title', label: <NoticeBreadcrumbValue schoolId={params.schoolId} sessionId={params.sessionId} noticeId={noticeId} /> },
  ],
});

export const noticeEditPage = defineManagementPage<NoticeRouteParams>({
  matches: (pathname) =>
    /^\/school\/[^/]+\/sessions\/[^/]+\/notices\/[^/]+\/edit$/.test(pathname),
  title: 'Edit notice',
  breadcrumbs: ({ noticeId, ...params }) => [
    ...noticesTrail(params),
    { id: 'notice-title', label: <NoticeBreadcrumbValue schoolId={params.schoolId} sessionId={params.sessionId} noticeId={noticeId} />, href: noticeHref(params.schoolId, params.sessionId, noticeId) },
    { id: 'notice-edit', label: 'Edit' },
  ],
});

/** `new` is listed before the notice page: both patterns match `/notices/new`. */
export const noticePages = [noticesPage, newNoticePage, noticeDetailsPage, noticeEditPage];

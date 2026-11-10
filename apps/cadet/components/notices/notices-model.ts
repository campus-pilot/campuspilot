import { readSchoolFeatureDisabled } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import type { CadetNoticeListEntry } from '@campuspilot/components/cadet-portal';

import { formatDate } from '@/lib/format';
import { noticeHref } from '@/lib/route-param';

/** How many notices Home lists before "All notices". */
export const HOME_NOTICE_COUNT = 3;

/**
 * Whether a failed notice read means the school does not have notices (the
 * server's disabled-feature error for `notices`, see `docs/feature-flags.md`)
 * rather than that something went wrong. It is the only signal the portal
 * has: there is no separate "features" read for students, and the notice
 * procedures answer it on every call.
 */
export function noticesSwitchedOff(error: unknown): boolean {
  return readSchoolFeatureDisabled(error) === 'notices';
}

/** A NOT_FOUND answer: the notice does not exist or is not addressed to this student. */
export function noticeMissing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'NOT_FOUND';
}

/** "Published 3 Nov 2026" under a notice title. */
export function publishedLabel(publishedAt: Date | string): string {
  return `Published ${formatDate(publishedAt)}`;
}

/** List rows of notices, each linking to its own screen. */
export function noticeEntries(items: readonly { noticeId: string; title: string; publishedAt: Date | string }[]): CadetNoticeListEntry[] {
  return items.map((item) => ({ noticeId: item.noticeId, title: item.title, detail: publishedLabel(item.publishedAt), href: noticeHref(item.noticeId) }));
}

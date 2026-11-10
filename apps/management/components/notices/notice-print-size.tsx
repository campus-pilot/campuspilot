import type { NoticePageSize } from '@campuspilot/api/routers/school/notice/notice.dto';

import { noticePrintSizeDescription } from './notice-model';

/**
 * A notice's print size as the notice page states it: the size and what it
 * means for printing, as visible text (the sentence starts with the size,
 * "Half A4. Each A4 sheet prints two copies…"). Not a `title` tooltip, which
 * touch screens cannot reach and screen readers do not reliably announce
 * (review round 4, R4-4); the editor and publish dialog show the same
 * sentence.
 */
export function NoticePrintSize({ pageSize }: { pageSize: NoticePageSize }) {
  return <span>{noticePrintSizeDescription(pageSize)}</span>;
}

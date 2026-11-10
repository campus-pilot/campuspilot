import type { NoticeDto } from '@campuspilot/api/routers/school/notice/notice.dto';

import { orpc } from '@/lib/orpc';
import { savedNoticePreviewInput, savedNoticePreviewKeySuffix } from './notice-model';

/**
 * The saved notice's preview query, keyed by the version the page shows
 * (`savedNoticePreviewKeySuffix`). The notice page renders it and the
 * publish dialog reads the same cache entry as what was reviewed.
 */
export function savedNoticePreviewQueryOptions(notice: Pick<NoticeDto, 'schoolId' | 'id' | 'version'>) {
  const input = savedNoticePreviewInput(notice);
  return orpc.school.previewNotice.queryOptions({
    input,
    queryKey: [...orpc.school.previewNotice.queryKey({ input }), savedNoticePreviewKeySuffix(notice)],
    retry: false,
  });
}

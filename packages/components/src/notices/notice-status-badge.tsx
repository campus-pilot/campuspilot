import { Badge } from '@campuspilot/ui/components/badge';

export type NoticeStatus = 'draft' | 'published';

export const NOTICE_STATUS_LABELS: Record<NoticeStatus, string> = { draft: 'Draft', published: 'Published' };

/** A draft is quiet (outline); a published notice is the settled state. */
export function NoticeStatusBadge({ status }: { status: NoticeStatus }) {
  return <Badge variant={status === 'published' ? 'secondary' : 'outline'}>{NOTICE_STATUS_LABELS[status]}</Badge>;
}

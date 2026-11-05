import type { AssistantToolCallItemDto, AssistantViewItemDto } from '@campuspilot/assistant-contract/dto';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@campuspilot/ui/components/message-scroller';
import { cn } from '@campuspilot/ui/lib/utils';
import type { ReactNode } from 'react';

import { AssistantApprovalCard, type AssistantApprovalDecision } from './assistant-approval-card';
import { AssistantActivity, AssistantLiveStatus, AssistantRunNotice, AssistantUserMessageRow } from './assistant-rows';
import type { AssistantTimelineRow } from './timeline-model';

/** Lane shared by the conversation and the composer, so their edges line up. */
export const ASSISTANT_LANE_CLASS = 'mx-auto w-full max-w-(--assistant-lane)';

/**
 * Space under each row kind, after T3 Code's timeline rhythm: a user turn
 * gets room, the work it causes stays tight, replies settle in between.
 */
const ROW_SPACING: Record<AssistantTimelineRow['kind'], string> = {
  user: 'pb-2',
  activity: 'pb-1.5',
  live: 'pb-1.5',
  approval: 'pb-3',
  view: 'pt-1.5 pb-4',
  reply: 'pb-2',
  notice: 'pb-2',
};

export type AssistantTimelineProps = {
  rows: readonly AssistantTimelineRow[];
  /** Renders one reply; the caller subscribes it to its own streamed text. */
  renderReply: (itemId: string) => ReactNode;
  /** Renders a view with the app's components (records fetch their own data). */
  renderView: (item: AssistantViewItemDto) => ReactNode;
  onDecide: (call: AssistantToolCallItemDto, decision: AssistantApprovalDecision) => void;
  pendingDecision: (approvalId: string | undefined) => AssistantApprovalDecision | undefined;
  /** Rows the server has not confirmed yet (optimistic messages). */
  trailing?: ReactNode;
  /** Horizontal padding of the lane's container; the lane itself is centred. */
  gutterClassName?: string;
};

function TimelineRow({ row, ...props }: Omit<AssistantTimelineProps, 'rows' | 'trailing' | 'gutterClassName'> & { row: AssistantTimelineRow }) {
  switch (row.kind) {
    case 'user':
      return <AssistantUserMessageRow item={row.item} />;
    case 'reply':
      return props.renderReply(row.itemId);
    case 'activity':
      return <AssistantActivity calls={row.calls} />;
    case 'approval':
      return (
        <AssistantApprovalCard
          call={row.call}
          pendingDecision={props.pendingDecision(row.call.body.approvalId)}
          onDecide={(decision) => props.onDecide(row.call, decision)}
        />
      );
    case 'view':
      return props.renderView(row.item);
    case 'live':
      return <AssistantLiveStatus label={row.label} since={row.since} />;
    case 'notice':
      return <AssistantRunNotice run={row.run} />;
  }
}

/**
 * The scrolling conversation. It follows new content while the reader is at
 * the end, anchors each new user turn, and offers a jump-to-latest pill.
 */
export function AssistantTimeline({ rows, trailing, gutterClassName = 'px-4 sm:px-6', ...props }: AssistantTimelineProps) {
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller>
        <MessageScrollerViewport aria-label="Conversation">
          <MessageScrollerContent className={cn('gap-0 pt-4 pb-6', gutterClassName)}>
            {rows.map((row, index) => (
              <MessageScrollerItem
                key={row.id}
                messageId={row.id}
                scrollAnchor={row.kind === 'user'}
                className={cn(ASSISTANT_LANE_CLASS, ROW_SPACING[row.kind], row.kind === 'user' && index > 0 && 'pt-5')}
              >
                <TimelineRow row={row} {...props} />
              </MessageScrollerItem>
            ))}
            {trailing ? <div className={ASSISTANT_LANE_CLASS}>{trailing}</div> : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton variant="outline" className="rounded-full bg-background/80 shadow-composer backdrop-blur" />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

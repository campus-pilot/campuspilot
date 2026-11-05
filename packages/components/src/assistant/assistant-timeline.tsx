import type { AssistantViewItemDto } from '@campuspilot/assistant-contract/dto';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@campuspilot/ui/components/message-scroller';
import { cn } from '@campuspilot/ui/lib/utils';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

import { AssistantApprovalCard } from './assistant-approval-card';
import {
  AssistantActivity,
  AssistantLiveStatus,
  AssistantRunNotice,
  AssistantUserMessageRow,
  AssistantWorkBar,
} from './assistant-rows';
import type { AssistantTimelineRow } from './timeline-model';

/** Lane shared by the conversation and the composer, so their edges line up. */
export const ASSISTANT_LANE_CLASS = 'mx-auto w-full max-w-(--assistant-lane)';

/**
 * Space after each row kind; every row owns the space below it and rows
 * have no margins (T3 Code). A question gets room, the work it causes stays
 * tight, and an answer with its meta row settles the turn.
 */
function rowSpacing(row: AssistantTimelineRow, previous: AssistantTimelineRow | undefined): string {
  switch (row.kind) {
    case 'user':
      // The bubble's 24px hover row (time, copy) already spaces it from what follows.
      // A turn that folded to its bar alone needs the room an answer would leave.
      return cn('pb-1', previous?.kind === 'work' && 'pt-4');
    case 'work':
      return 'pb-2.5';
    case 'activity':
    case 'approval':
    case 'live':
      return 'pb-1.5';
    case 'view':
      return 'pt-1 pb-4';
    case 'reply':
      return row.meta ? 'pb-4' : 'pb-2';
    case 'notice':
      return 'pb-4';
  }
}

/** Inside a fold, work stacks tightly and interim replies keep a little air. */
const FOLDED_SPACING: Partial<Record<AssistantTimelineRow['kind'], string>> = {
  activity: 'pb-1',
  approval: 'pb-1',
  reply: 'py-1.5',
};

export type AssistantTimelineProps = {
  rows: readonly AssistantTimelineRow[];
  /** Renders one reply; the caller subscribes it to its own streamed text. */
  renderReply: (itemId: string, meta: boolean) => ReactNode;
  /** Renders a view with the app's components (records fetch their own data). */
  renderView: (item: AssistantViewItemDto) => ReactNode;
  /** Rows the server has not confirmed yet (optimistic messages). */
  trailing?: ReactNode;
  /** Horizontal padding of the lane's container; the lane itself is centred. */
  gutterClassName?: string;
};

type RowRenderers = Pick<AssistantTimelineProps, 'renderReply' | 'renderView'>;

function TimelineRow({ row, ...renderers }: RowRenderers & { row: AssistantTimelineRow }) {
  switch (row.kind) {
    case 'user':
      return <AssistantUserMessageRow item={row.item} />;
    case 'reply':
      return renderers.renderReply(row.itemId, row.meta);
    case 'activity':
      return <AssistantActivity calls={row.calls} />;
    case 'approval':
      return <AssistantApprovalCard call={row.call} />;
    case 'view':
      return renderers.renderView(row.item);
    case 'live':
      return <AssistantLiveStatus label={row.label} />;
    case 'notice':
      return <AssistantRunNotice run={row.run} />;
    case 'work':
      return (
        <AssistantWorkBar state={row.state} since={row.since} until={row.until} pending={row.pending} changes={row.changes}>
          {row.folded.length
            ? row.folded.map((child) => (
                <div key={child.id} className={FOLDED_SPACING[child.kind]}>
                  <TimelineRow row={child} {...renderers} />
                </div>
              ))
            : null}
        </AssistantWorkBar>
      );
  }
}

/**
 * The scrolling conversation. It follows new content while the reader is at
 * the end, anchors each new user turn, and offers a "Scroll to end" pill.
 */
export function AssistantTimeline({ rows, trailing, gutterClassName = 'px-4 sm:px-6', ...renderers }: AssistantTimelineProps) {
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
                className={cn(ASSISTANT_LANE_CLASS, rowSpacing(row, rows[index - 1]))}
              >
                <TimelineRow row={row} {...renderers} />
              </MessageScrollerItem>
            ))}
            {trailing ? <div className={ASSISTANT_LANE_CLASS}>{trailing}</div> : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton
          variant="outline"
          size="sm"
          className="h-7 gap-1 rounded-full border-border/60 bg-background px-2.5 text-xs text-foreground shadow-sm hover:border-border hover:bg-background data-[direction=end]:bottom-3"
        >
          <ChevronDown aria-hidden />
          Scroll to end
        </MessageScrollerButton>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

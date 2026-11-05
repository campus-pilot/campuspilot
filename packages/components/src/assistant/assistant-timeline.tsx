import type { AssistantToolCallItemDto } from '@campuspilot/assistant-contract/dto';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@campuspilot/ui/components/message-scroller';
import type { ReactNode } from 'react';

import { AssistantApprovalCard, type AssistantApprovalDecision } from './assistant-approval-card';
import { AssistantActivity, AssistantRunNotice, AssistantUserMessage } from './assistant-rows';
import type { AssistantTimelineRow } from './timeline-model';

export type AssistantTimelineProps = {
  rows: readonly AssistantTimelineRow[];
  /**
   * Renders one reply by id. The caller subscribes that row to its own text,
   * so streaming re-renders the reply and nothing else.
   */
  renderReply: (itemId: string) => ReactNode;
  onDecide: (call: AssistantToolCallItemDto, decision: AssistantApprovalDecision) => void;
  pendingDecision: (approvalId: string | undefined) => AssistantApprovalDecision | undefined;
  /** Shown when there are no rows yet. */
  empty?: ReactNode;
};

function TimelineRow({ row, ...props }: Omit<AssistantTimelineProps, 'rows' | 'empty'> & { row: AssistantTimelineRow }) {
  switch (row.kind) {
    case 'user':
      return <AssistantUserMessage item={row.item} />;
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
    case 'notice':
      return <AssistantRunNotice run={row.run} />;
  }
}

/** The scrolling conversation; follows new content while the reader is at the end. */
export function AssistantTimeline({ rows, empty, ...props }: AssistantTimelineProps) {
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller>
        <MessageScrollerViewport aria-label="Conversation">
          <MessageScrollerContent className="gap-4 p-3">
            {rows.length === 0 ? empty : null}
            {rows.map((row) => (
              <MessageScrollerItem key={row.id} messageId={row.id} scrollAnchor={row.kind === 'user'}>
                <TimelineRow row={row} {...props} />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

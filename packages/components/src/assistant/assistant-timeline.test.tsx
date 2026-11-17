// @vitest-environment jsdom
import type { AssistantUserMessageItemDto } from '@campuspilot/assistant-contract/dto';
import { TooltipProvider } from '@campuspilot/ui/components/tooltip';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AssistantTimeline } from './assistant-timeline';
import type { AssistantTimelineRow } from './timeline-model';

afterEach(cleanup);

beforeAll(() => {
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
  globalThis.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver;
  globalThis.MutationObserver ??= NoopObserver as unknown as typeof MutationObserver;
});

const question = (id: string, text: string): AssistantTimelineRow => ({
  kind: 'user',
  id,
  item: {
    id,
    conversationId: 'c1',
    runId: `run-${id}`,
    position: 0,
    sequence: 0,
    createdAt: new Date(2026, 10, 17),
    updatedAt: new Date(2026, 10, 17),
    kind: 'user_message',
    status: 'complete',
    body: { text },
  } satisfies AssistantUserMessageItemDto,
});
const answer = (id: string): AssistantTimelineRow => ({ kind: 'reply', id, itemId: id, meta: true });

describe('AssistantTimeline', () => {
  it('pins only the newest question, so a send never scrolls back to an older one', () => {
    const rows = [question('q1', 'How many classes?'), answer('a1'), question('q2', 'And sections?'), answer('a2'), question('q3', 'Who is the principal?')];
    const { container } = render(
      <TooltipProvider>
        <AssistantTimeline rows={rows} renderReply={(id) => <p>Answer {id}</p>} renderView={() => null} renderCard={() => null} />
      </TooltipProvider>,
    );
    const anchors = [...container.querySelectorAll('[data-scroll-anchor="true"]')].map((element) => element.getAttribute('data-message-id'));
    expect(anchors).toEqual(['q3']);
  });
});

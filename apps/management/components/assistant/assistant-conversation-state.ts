import {
  ASSISTANT_TERMINAL_RUN_STATUSES,
  type AssistantConversationDto,
  type AssistantItemDto,
  type AssistantRunDto,
  type AssistantStreamEvent,
} from '@campuspilot/assistant-contract/dto';

/**
 * Client view of one conversation. `text` holds streamed text apart from
 * `items`, so a text frame replaces only `text` and every consumer that
 * selects items or runs keeps the same references (no re-render).
 */
export type AssistantConversationState = {
  conversation: AssistantConversationDto | null;
  items: readonly AssistantItemDto[];
  runs: readonly AssistantRunDto[];
  /** Latest streamed text of messages that are still streaming. */
  text: Readonly<Record<string, string>>;
  /** Highest change sequence held: the cursor a reconnect resumes from. */
  sequence: number;
  /**
   * The sequence held when the conversation was first loaded here. Anything
   * newer arrived while it was open, which is how a finished answer is told
   * apart from history (for the screen-reader announcement).
   */
  openedSequence: number;
  /**
   * Whether the stream is connected and has caught up (after its snapshot or
   * resume). False from the moment a connection drops until the next one
   * has caught up, which is what the "Reconnecting…" notice reads.
   */
  synchronized: boolean;
};

export const EMPTY_CONVERSATION_STATE: AssistantConversationState = {
  conversation: null,
  items: [],
  runs: [],
  text: {},
  sequence: 0,
  openedSequence: 0,
  synchronized: false,
};

function highestSequence(
  conversation: AssistantConversationDto,
  items: readonly AssistantItemDto[],
  runs: readonly AssistantRunDto[],
  floor = 0,
): number {
  return Math.max(
    floor,
    conversation.lastSequence,
    ...items.map((item) => item.sequence),
    ...runs.map((run) => run.sequence),
  );
}

function upsertBySequence<T extends { id: string; sequence: number }>(
  list: readonly T[],
  next: T,
  order: (a: T, b: T) => number,
): readonly T[] {
  const index = list.findIndex((entry) => entry.id === next.id);
  if (index === -1) return [...list, next].sort(order);
  // Ignore anything not newer than what the snapshot or a later event gave us.
  if (list[index]!.sequence >= next.sequence) return list;
  const copy = list.slice();
  copy[index] = next;
  return copy;
}

const byPosition = (a: AssistantItemDto, b: AssistantItemDto) => a.position - b.position;
const byCreation = (a: AssistantRunDto, b: AssistantRunDto) =>
  a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

function withoutText(text: Readonly<Record<string, string>>, itemId: string) {
  if (!(itemId in text)) return text;
  const { [itemId]: _dropped, ...rest } = text;
  return rest;
}

/** Applies one stream event; returns the same state object when nothing changed. */
export function applyAssistantEvent(
  state: AssistantConversationState,
  event: AssistantStreamEvent,
): AssistantConversationState {
  switch (event.type) {
    case 'snapshot': {
      const sequence = highestSequence(event.conversation, event.items, event.runs);
      return {
        conversation: event.conversation,
        items: [...event.items].sort(byPosition),
        runs: [...event.runs].sort(byCreation),
        text: {},
        sequence,
        // A later snapshot (a large catch-up after a reconnect) keeps the first one's mark.
        openedSequence: state.conversation ? state.openedSequence : sequence,
        synchronized: false,
      };
    }
    case 'resume': {
      // Changes since our cursor, merged over what is already on screen.
      // `openedSequence` is spread in unchanged.
      const items = event.items.reduce((list, item) => upsertBySequence(list, item, byPosition), state.items);
      const runs = event.runs.reduce((list, run) => upsertBySequence(list, run, byCreation), state.runs);
      const finished = event.items.filter((item) => item.status !== 'streaming').map((item) => item.id);
      return {
        ...state,
        conversation: event.conversation,
        items,
        runs,
        text: finished.reduce(withoutText, state.text),
        sequence: highestSequence(event.conversation, event.items, event.runs, state.sequence),
        synchronized: false,
      };
    }
    case 'synchronized':
      return state.synchronized ? state : { ...state, synchronized: true };
    case 'heartbeat':
      return state;
    case 'conversation':
      return { ...state, conversation: event.conversation };
    case 'run': {
      const runs = upsertBySequence(state.runs, event.run, byCreation);
      return runs === state.runs ? state : { ...state, runs, sequence: Math.max(state.sequence, event.run.sequence) };
    }
    case 'item': {
      const items = upsertBySequence(state.items, event.item, byPosition);
      if (items === state.items) return state;
      const finished = event.item.status !== 'streaming';
      return {
        ...state,
        items,
        text: finished ? withoutText(state.text, event.item.id) : state.text,
        sequence: Math.max(state.sequence, event.item.sequence),
      };
    }
    case 'text': {
      const item = state.items.find((entry) => entry.id === event.itemId);
      // Drop frames for a message that already completed: its full text is saved.
      if (item && item.status !== 'streaming') return state;
      const current = state.text[event.itemId] ?? '';
      const end = event.offset + event.delta.length;
      // A duplicate (already have it) or a gap (missed a frame): ignore; the
      // completed message carries the full text either way.
      if (end <= current.length || event.offset > current.length) return state;
      const next = current.slice(0, event.offset) + event.delta;
      return { ...state, text: { ...state.text, [event.itemId]: next } };
    }
  }
}

/** The state once its connection has dropped; the same object when already marked. */
export function withConnectionLost(state: AssistantConversationState): AssistantConversationState {
  return state.synchronized ? { ...state, synchronized: false } : state;
}

/** Whether an item is a change the assistant made that went through. */
export function isSucceededWrite(item: AssistantItemDto): boolean {
  return item.kind === 'tool_call' && item.status === 'succeeded' && item.body.access === 'write';
}

/**
 * Whether a catch-up (`resume` or `snapshot`) carries a change that went
 * through after `cursor`, the sequence held before reconnecting: such a
 * change happened while this tab was not listening, so open screens have
 * not been refreshed for it yet.
 */
export function hasSucceededWriteAfter(items: readonly AssistantItemDto[], cursor: number): boolean {
  return items.some((item) => item.sequence > cursor && isSucceededWrite(item));
}

/**
 * Whether an event means the assistant changed CampusPilot data, so open
 * screens should refresh: a change going through live, or a catch-up after a
 * reconnect that carries one made meanwhile. `cursor` is the sequence held
 * before this connection, or null on a first load, whose snapshot is history
 * the app has already loaded for itself.
 */
export function eventChangedSchoolData(event: AssistantStreamEvent, cursor: number | null): boolean {
  if (event.type === 'item') return isSucceededWrite(event.item);
  if (event.type === 'resume' || event.type === 'snapshot') {
    return cursor !== null && hasSucceededWriteAfter(event.items, cursor);
  }
  return false;
}

/**
 * Whether an event can change the conversation history list: the
 * conversation itself (its title, its place in the order), or a run
 * reaching a state the list shows as the row's dot: a new run in the queue,
 * a run pausing for approval, a run ending. A running run reports every
 * step it takes; those are left out, since the list refreshes itself every
 * few seconds while a row is working.
 */
export function eventChangedConversationList(event: AssistantStreamEvent): boolean {
  if (event.type === 'conversation') return true;
  if (event.type !== 'run') return false;
  return (
    ASSISTANT_TERMINAL_RUN_STATUSES.has(event.run.status) ||
    event.run.status === 'queued' ||
    event.run.status === 'awaiting_approval'
  );
}

/**
 * Whether the user may stop a turn (or remove a queued message, which stops
 * its run): always their own; someone else's only with the right to write in
 * the conversation (a conversation shared with a paper, which the server
 * allows to whoever may continue it). `ownerId` null: not known, so not theirs.
 */
export const mayStopTurn = (facts: { canWrite: boolean; userId: string | null; ownerId: string | null | undefined }) =>
  facts.canWrite || (facts.userId !== null && facts.ownerId === facts.userId);

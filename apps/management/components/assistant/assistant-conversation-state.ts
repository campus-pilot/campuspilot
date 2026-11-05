import type {
  AssistantConversationDto,
  AssistantItemDto,
  AssistantRunDto,
  AssistantStreamEvent,
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
};

export const EMPTY_CONVERSATION_STATE: AssistantConversationState = {
  conversation: null,
  items: [],
  runs: [],
  text: {},
};

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
    case 'snapshot':
      return {
        conversation: event.conversation,
        items: [...event.items].sort(byPosition),
        runs: [...event.runs].sort(byCreation),
        text: {},
      };
    case 'conversation':
      return { ...state, conversation: event.conversation };
    case 'run': {
      const runs = upsertBySequence(state.runs, event.run, byCreation);
      return runs === state.runs ? state : { ...state, runs };
    }
    case 'item': {
      const items = upsertBySequence(state.items, event.item, byPosition);
      if (items === state.items) return state;
      const finished = event.item.status !== 'streaming';
      return { ...state, items, text: finished ? withoutText(state.text, event.item.id) : state.text };
    }
    case 'text': {
      const item = state.items.find((entry) => entry.id === event.itemId);
      // Frames can outrun the item they belong to; keep them until it arrives,
      // and drop late frames for a message that has already completed.
      if (item && item.status !== 'streaming') return state;
      if (state.text[event.itemId] === event.text) return state;
      return { ...state, text: { ...state.text, [event.itemId]: event.text } };
    }
  }
}

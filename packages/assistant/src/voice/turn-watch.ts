import {
  ASSISTANT_TERMINAL_RUN_STATUSES,
  type AssistantItemDto,
  type AssistantRunDto,
  type AssistantStreamEvent,
} from '@campuspilot/assistant-contract/dto';

import { db } from '../db';
import { liveEvents, subscribeAssistantEvents } from '../events';
import { log } from '../log';
import * as store from '../store';

/**
 * Follows the run a spoken request started until it ends, so the voice model
 * can be told what happened. It only reads the conversation's own rows and
 * live events, the same ones the browser's stream shows; it never runs
 * anything.
 */

/** How a run ended, in the words the voice model is given. */
export type TurnOutcome =
  | {
      status: 'done';
      /** What the assistant wrote as its answer. */
      answer: string;
      /** The views it put on the user's screen, by kind and heading. */
      onScreen: string[];
      /** The changes it made (each approved by the user on screen). */
      changesMade: string[];
      /** The changes the user declined. */
      changesDeclined: string[];
    }
  | { status: 'failed'; error: string }
  | { status: 'stopped' };

export type TurnUpdate =
  /** A change of this run waits for the user's decision on screen. */
  | { type: 'approval'; change: string }
  | { type: 'settled'; outcome: TurnOutcome };

export type TurnWatch = { stop: () => Promise<void> };

/** The longest answer passed to the voice model; it speaks a sentence or two of it. */
const ANSWER_MAX_CHARS = 4_000;

const VIEW_KIND_LABEL: Record<string, string> = {
  records: 'List',
  exam_result: 'Examination result',
  documents: 'Documents',
  question_paper: 'Question paper',
  table: 'Table',
  stats: 'Figures',
  details: 'Details',
  bars: 'Chart',
  notice: 'Notice',
};

/** How a finished run ended, from its row and its items. */
export function turnOutcomeOf(run: AssistantRunDto, items: readonly AssistantItemDto[]): TurnOutcome {
  if (run.status === 'cancelled') return { status: 'stopped' };
  if (run.status === 'failed') return { status: 'failed', error: run.errorMessage ?? 'The assistant could not finish this request.' };
  const own = items.filter((item) => item.runId === run.id).sort((a, b) => a.position - b.position);
  const answer = own
    .flatMap((item) => (item.kind === 'assistant_message' && item.body.text.trim() ? [item.body.text.trim()] : []))
    .join('\n\n');
  const toolCalls = own.flatMap((item) => (item.kind === 'tool_call' && item.body.access === 'write' ? [item] : []));
  return {
    status: 'done',
    answer: answer.length > ANSWER_MAX_CHARS ? `${answer.slice(0, ANSWER_MAX_CHARS)}…` : answer,
    onScreen: own.flatMap((item) => {
      if (item.kind !== 'view') return [];
      const kind = VIEW_KIND_LABEL[item.body.view.type] ?? 'View';
      return [item.body.view.title ? `${kind}: ${item.body.view.title}` : kind];
    }),
    changesMade: toolCalls.filter((item) => item.status === 'succeeded').map((item) => item.body.title),
    changesDeclined: toolCalls.filter((item) => item.status === 'declined').map((item) => item.body.title),
  };
}

/**
 * What to tell the voice model about a run now, given what it was already
 * told: each change waiting for approval once (by item id), then the outcome
 * once the run has ended.
 */
export function turnUpdatesOf(run: AssistantRunDto, items: readonly AssistantItemDto[], announced: ReadonlySet<string>): { updates: TurnUpdate[]; announced: string[] } {
  if (ASSISTANT_TERMINAL_RUN_STATUSES.has(run.status)) {
    return { updates: [{ type: 'settled', outcome: turnOutcomeOf(run, items) }], announced: [] };
  }
  const waiting = items.filter((item) => item.runId === run.id && item.kind === 'tool_call' && item.status === 'awaiting_approval' && !announced.has(item.id));
  return {
    updates: waiting.flatMap((item) => (item.kind === 'tool_call' ? [{ type: 'approval' as const, change: item.body.title }] : [])),
    announced: waiting.map((item) => item.id),
  };
}

/** How often the run is read again from the database while its live events are quiet. */
const RESYNC_MS = 10_000;

/**
 * Watches run `runId` of a conversation and calls `onUpdate` for each change
 * waiting for approval and, last, for its outcome. Resolves once watching has
 * started; rejects when the run does not exist in the conversation.
 *
 * It subscribes before it reads, so nothing committed in between is missed,
 * and reads the conversation again whenever the live events are quiet for
 * {@link RESYNC_MS}: they are fire-and-forget (events.ts), so a lost one
 * would otherwise leave the voice model waiting for ever.
 */
export async function watchTurn(turn: { conversationId: string; runId: string }, onUpdate: (update: TurnUpdate) => void): Promise<TurnWatch> {
  const subscription = await subscribeAssistantEvents(turn.conversationId);
  // Held in an object: it is assigned inside the closures below, which TypeScript's narrowing does not follow.
  const state: { run: AssistantRunDto | null } = { run: null };
  const items = new Map<string, AssistantItemDto>();
  const announced = new Set<string>();
  let settled = false;

  const resync = async () => {
    const snapshot = await store.loadSnapshot(db, turn.conversationId);
    state.run = snapshot?.runs.find((candidate) => candidate.id === turn.runId) ?? null;
    for (const item of snapshot?.items ?? []) if (item.runId === turn.runId) items.set(item.id, item);
  };
  const report = () => {
    if (!state.run || settled) return;
    const next = turnUpdatesOf(state.run, [...items.values()], announced);
    for (const id of next.announced) announced.add(id);
    for (const update of next.updates) {
      if (update.type === 'settled') settled = true;
      onUpdate(update);
    }
  };
  const apply = (event: AssistantStreamEvent) => {
    if (event.type === 'run' && event.run.id === turn.runId) state.run = event.run;
    if (event.type === 'item' && event.item.runId === turn.runId) items.set(event.item.id, event.item);
  };

  try {
    await resync();
    if (!state.run) throw new Error('The run was not found in the conversation.');
  } catch (error) {
    await subscription.close();
    throw error;
  }
  report();

  void (async () => {
    try {
      for await (const event of liveEvents(subscription, RESYNC_MS)) {
        if (settled) break;
        if (event === 'heartbeat') await resync();
        else apply(event);
        report();
        if (settled) break;
      }
    } catch (err) {
      log.warn({ err, runId: turn.runId }, 'assistant.voice.turn-watch.failed');
      if (!settled) {
        settled = true;
        onUpdate({ type: 'settled', outcome: { status: 'failed', error: 'The assistant’s answer could not be read. It is on the screen if it finished.' } });
      }
    } finally {
      await subscription.close();
    }
  })();

  return {
    stop: async () => {
      settled = true;
      await subscription.close();
    },
  };
}

import type { VoiceClientMessage, VoiceEndReason, VoiceServerMessage } from '@campuspilot/assistant-contract/voice';

import { voiceDestinationSchema } from '@campuspilot/assistant-contract/voice';

import { APP_NOTE_PREFIX, ASK_ASSISTANT_TOOL, OPEN_ON_SCREEN_TOOL, OPEN_PAGE_TOOL, READ_SCREEN_TOOL } from './prompt';
import type { VoiceConnection, VoiceEvent, VoiceProvider, VoiceToolCall, VoiceToolDeclaration, VoiceUsage } from './provider';
import type { TurnOutcome, TurnUpdate, TurnWatch } from './turn-watch';

/**
 * One voice session: the browser's socket on one side, the voice model on the
 * other, and the runs spoken requests start in between.
 *
 * It decides nothing about school data. A request the voice model passes on
 * (`ask_assistant`) goes to the browser, which sends it as an ordinary
 * assistant message; this session then follows that run and tells the voice
 * model how it ended. Everything it needs from outside (the model, the
 * socket, the database, the access decision) is injected, so the whole flow
 * runs in tests against a scripted provider.
 */

export type VoiceSessionRefusal = { reason: VoiceEndReason; message: string };

export type VoiceSessionDeps = {
  sessionId: string;
  provider: VoiceProvider;
  instructions: string;
  /** The tools this session's voice model is offered (`voiceTools` of its kind). */
  tools: readonly VoiceToolDeclaration[];
  /** The longest the session may last, and how long it may stay quiet with nothing running. */
  limits: { maxSessionMs: number; idleMs: number };
  /** A text frame to the browser. */
  send: (message: VoiceServerMessage) => void;
  /** An audio frame to the browser. */
  sendAudio: (pcm: Uint8Array) => void;
  /** Closes the browser's socket; called once, after `ended` was sent. */
  closeSocket: () => void;
  /** Saves the usage of reply number `reply` of this session. */
  recordUsage: (usage: VoiceUsage, reply: number) => Promise<void>;
  /** Why the user may no longer use voice, or null while they may. */
  refusal: () => Promise<VoiceSessionRefusal | null>;
  /**
   * Starts following the run the browser says it started for a request.
   * Rejects when that run is not this user's own in this school.
   */
  watchTurn: (turn: { conversationId: string; runId: string }, onUpdate: (update: TurnUpdate) => void) => Promise<TurnWatch>;
  log: { info: (fields: object, message: string) => void; warn: (fields: object, message: string) => void };
  now?: () => number;
};

/** How often the session checks its time limits. */
const TICK_MS = 5_000;

/** How often an open session confirms its user may still use voice. */
const ACCESS_RECHECK_MS = 60_000;

/**
 * How long the voice model's connection is kept, after the session ended or
 * while it must be replaced, for the reply in progress to finish: its usage
 * arrives only when it ends, a few seconds after its last audio.
 */
const REPLY_GRACE_MS = 5_000;

/** How often a reply's cost is written again after a failed write, and the first wait between tries. */
const USAGE_WRITE_ATTEMPTS = 4;
const USAGE_RETRY_MS = 500;

/** How many times in a row a dropped connection to the voice model is restored before the session gives up. */
const RECONNECT_ATTEMPTS = 3;

const END_MESSAGES: Record<Exclude<VoiceEndReason, 'limit_reached' | 'access'>, string> = {
  ended: 'Voice ended.',
  replaced: 'Voice continued in another window.',
  restarting: 'The server is restarting. Start voice again in a moment.',
  idle: 'Voice ended because it was quiet for a while.',
  max_duration: 'This voice session reached its time limit. Start voice again to continue.',
  unavailable: 'Voice is not available right now. You can keep typing.',
  error: 'Voice stopped because something went wrong. You can keep typing.',
};

/** One request the voice model passed on and is waiting to hear about. */
type Ask = {
  /** The voice model's id of the call. */
  callId: string;
  /**
   * Whether the voice model still waits for this call on the current
   * connection. False after it cancelled the call or the connection was
   * replaced: the outcome is then told as a note, because a result for a call
   * it no longer knows is dropped.
   */
  awaited: boolean;
  /** The browser answered this request (with a run, or that it could not send it); a second answer is ignored. */
  answered: boolean;
  watch: TurnWatch | null;
};

/** The outcome of a request as the voice model reads it (a tool result, or the body of a note). */
function resultOf(outcome: TurnOutcome): Record<string, unknown> {
  if (outcome.status === 'stopped') return { status: 'stopped', note: 'The user stopped this request. Nothing more will happen.' };
  if (outcome.status === 'failed') return { status: 'failed', error: outcome.error };
  return {
    status: 'done',
    answer: outcome.answer || 'The assistant finished without writing an answer.',
    ...(outcome.onScreen.length > 0 ? { shown_on_screen: outcome.onScreen } : {}),
    ...(outcome.changesMade.length > 0 ? { changes_made: outcome.changesMade } : {}),
    ...(outcome.changesDeclined.length > 0 ? { changes_the_user_declined: outcome.changesDeclined } : {}),
  };
}

export class VoiceSession {
  private readonly deps: VoiceSessionDeps;
  private readonly now: () => number;
  private connection: VoiceConnection | null = null;
  /** Counts connections, so events of one that was replaced are ignored. */
  private connectionNumber = 0;
  private resumeHandle: string | null = null;
  private reconnecting = false;
  private readonly asks = new Map<string, Ask>();
  private askCount = 0;
  /** Pages the browser was asked to open and has not answered about yet, by open id, with the voice model's call. */
  private readonly opens = new Map<string, { callId: string; name: string }>();
  private openCount = 0;
  /** Screen reads the browser has not answered yet, by read id, with the voice model's call id. */
  private readonly reads = new Map<string, string>();
  private readCount = 0;
  private replyCount = 0;
  private reconnectCount = 0;
  /**
   * Whether the voice model has produced something whose usage has not been
   * reported yet (audio, words or a tool call since the last usage report).
   */
  private replyOpen = false;
  /** Set while the connection must be replaced but a reply is still finishing; fires the replacement at the latest. */
  private replaceAfterReply: ReturnType<typeof setTimeout> | null = null;
  /** The connection of an ended session, kept only to receive its last reply's usage; and the timer that closes it. */
  private draining: { connection: VoiceConnection; timer: ReturnType<typeof setTimeout> } | null = null;
  /** News for the voice model that arrived while it had no connection (it was being replaced); sent once it is back. */
  private readonly notesWhileAway: string[] = [];
  private userSpeaking = false;
  /**
   * Whether the user has spoken since the last request was passed on and
   * since text they did not say last reached the voice model: news of a
   * request (its outcome, a change waiting for approval), the page's text or
   * the names of its links. A request is passed on only then: what the voice
   * model reads there (school data, which anyone may have written) must never
   * become a request of the user's by itself, also not when the user said
   * "okay" while the assistant was still working. It raises the bar and is not the protection: a change still
   * waits for the user's tap, and a lookup shows its result only to the user.
   */
  private userSpokeSinceAsk = false;
  private heard = '';
  private said = '';
  /** The assistant's current reply ended, so the next thing it says starts a new caption. */
  private replyEnded = true;
  private startedAt = 0;
  private lastActivityAt = 0;
  private accessCheckedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ended = false;

  constructor(deps: VoiceSessionDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /** Connects to the voice model and tells the browser it may talk. Rejects when the model cannot be reached. */
  async start(): Promise<void> {
    this.startedAt = this.lastActivityAt = this.accessCheckedAt = this.now();
    await this.connect();
    if (this.ended) return;
    this.deps.send({ type: 'ready', sessionId: this.deps.sessionId, maxSeconds: Math.round(this.deps.limits.maxSessionMs / 1000) });
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  /**
   * Runs one piece of the session's work so that nothing it throws leaves the
   * session: a socket that broke between two frames, a write that failed. Every
   * way into the session goes through here (the browser's frames, the voice
   * model's events, the clock). An error ends this session alone; it must
   * never reach the server's event loop, where it would take down every
   * school's sessions and requests with it.
   */
  private contained(work: () => void): void {
    try {
      work();
    } catch (err) {
      this.deps.log.warn({ err, voiceSessionId: this.deps.sessionId }, 'assistant.voice.session.failed');
      this.end('error');
    }
  }

  /** Microphone audio from the browser. Dropped while the voice model is being reconnected. */
  handleAudio(pcm: Uint8Array): void {
    this.contained(() => {
      if (!this.ended) this.connection?.sendAudio(pcm);
    });
  }

  handleMessage(message: VoiceClientMessage): void {
    this.contained(() => this.onMessage(message));
  }

  private onMessage(message: VoiceClientMessage): void {
    if (this.ended) return;
    if (message.type === 'end') return this.end('ended');
    if (message.type === 'mic') {
      if (!message.open) this.connection?.endAudio();
      return;
    }
    if (message.type === 'screen') {
      const callId = this.reads.get(message.readId);
      if (!callId) return;
      this.reads.delete(message.readId);
      this.connection?.sendToolResult({
        id: callId,
        name: READ_SCREEN_TOOL,
        output: message.text
          ? {
              status: 'read',
              page_title: message.title,
              page_text: message.text,
              // The user moves between pages and scrolls: this reading answers this question only.
              valid: 'Only for the question just asked. Read the screen again for any later question.',
            }
          : { status: 'not_read', error: 'The screen could not be read here.' },
        delivery: 'when_idle',
        final: true,
      });
      // The voice model now holds text from the page, which anyone may have written: see `userSpokeSinceAsk`.
      if (message.text) this.userSpokeSinceAsk = false;
      return;
    }
    if (message.type === 'opened') {
      const open = this.opens.get(message.openId);
      if (!open) return;
      this.opens.delete(message.openId);
      this.connection?.sendToolResult({
        id: open.callId,
        name: open.name,
        output: message.opened
          ? { status: 'opened' }
          : {
              status: 'not_opened',
              error: message.message ?? 'The page could not be opened.',
              ...(message.linksOnScreen ? { links_on_screen: message.linksOnScreen } : {}),
            },
        delivery: 'when_idle',
        final: true,
      });
      // The names of the page's links are page text too.
      if (!message.opened && message.linksOnScreen?.length) this.userSpokeSinceAsk = false;
      return;
    }
    const ask = this.asks.get(message.askId);
    // An answer for a request this session never made, or a second answer for one.
    if (!ask || ask.answered) return;
    ask.answered = true;
    if (message.type === 'turn_failed') {
      this.settle(message.askId, { status: 'not_sent', error: message.message || 'The request could not be sent.' });
      return;
    }
    void this.follow(message.askId, ask, { conversationId: message.conversationId, runId: message.runId });
  }

  /** The browser's socket closed (the tab went away, or the network did). */
  handleSocketClosed(): void {
    this.end('ended', { notify: false });
  }

  /** Ends the session: closes the voice model's connection, stops following runs, tells the browser and closes its socket. */
  end(reason: VoiceEndReason, options: { message?: string; notify?: boolean } = {}): void {
    if (this.ended) return;
    this.ended = true;
    if (this.timer) clearInterval(this.timer);
    // Ending must always finish, whatever state each part is in: each step is tried on its own.
    const attempt = (step: () => void) => {
      try {
        step();
      } catch (err) {
        this.deps.log.warn({ err, voiceSessionId: this.deps.sessionId }, 'assistant.voice.session.end-step-failed');
      }
    };
    const connection = this.connection;
    this.connection = null;
    if (this.replaceAfterReply) clearTimeout(this.replaceAfterReply);
    this.replaceAfterReply = null;
    if (connection && this.replyOpen) {
      // The reply in progress is billed whether or not anyone hears its end: keep the connection just long enough to learn its cost.
      const timer = setTimeout(() => this.stopDraining(), REPLY_GRACE_MS);
      this.draining = { connection, timer };
    } else {
      attempt(() => connection?.close());
    }
    for (const ask of this.asks.values()) void ask.watch?.stop().catch(() => undefined);
    this.asks.clear();
    this.deps.log.info(
      {
        voiceSessionId: this.deps.sessionId,
        reason,
        seconds: Math.round((this.now() - this.startedAt) / 1000),
        replies: this.replyCount,
        requests: this.askCount,
        reconnects: this.reconnectCount,
      },
      'assistant.voice.session.ended',
    );
    if (options.notify !== false) {
      const message = options.message ?? (reason === 'limit_reached' || reason === 'access' ? 'Voice is no longer available.' : END_MESSAGES[reason]);
      attempt(() => this.deps.send({ type: 'ended', reason, message }));
    }
    attempt(() => this.deps.closeSocket());
  }

  /** Closes the connection an ended session kept for its last reply's usage. */
  private stopDraining(): void {
    const draining = this.draining;
    this.draining = null;
    if (!draining) return;
    clearTimeout(draining.timer);
    try {
      draining.connection.close();
    } catch {
      // A connection that cannot be closed is already gone.
    }
  }

  /**
   * Saves a reply's cost, trying again after a failed write: a database that
   * is away for a moment must not lose what the school was charged. Nothing is
   * thrown; a cost that could not be saved after every try is logged.
   */
  private saveUsage(usage: VoiceUsage, reply: number): void {
    const attempt = (tries: number) => {
      this.deps.recordUsage(usage, reply).catch((err: unknown) => {
        if (tries + 1 >= USAGE_WRITE_ATTEMPTS) {
          this.deps.log.warn({ err, voiceSessionId: this.deps.sessionId, reply, usage }, 'assistant.voice.usage.save-failed');
          return;
        }
        setTimeout(() => attempt(tries + 1), USAGE_RETRY_MS * 2 ** tries);
      });
    };
    attempt(0);
  }

  private async connect(): Promise<void> {
    const number = (this.connectionNumber += 1);
    const connection = await this.deps.provider.connect({
      instructions: this.deps.instructions,
      tools: this.deps.tools,
      resumeHandle: this.resumeHandle,
      onEvent: (event) => {
        if (number === this.connectionNumber) this.contained(() => this.onEvent(event));
      },
    });
    // The session ended, or another connection replaced this one, while it was opening.
    if (this.ended || number !== this.connectionNumber) {
      this.contained(() => connection.close());
      return;
    }
    this.connection = connection;
  }

  private onEvent(event: VoiceEvent): void {
    if (this.ended) {
      // Only the last reply's cost is still wanted; once it is known (or the connection closes) the session lets go.
      if (!this.draining) return;
      if (event.type === 'usage') this.saveUsage(event.usage, (this.replyCount += 1));
      if (event.type === 'usage' || event.type === 'closed') this.stopDraining();
      return;
    }
    switch (event.type) {
      case 'audio':
        this.lastActivityAt = this.now();
        this.replyOpen = true;
        return this.deps.sendAudio(event.pcm);
      case 'user_speaking':
        this.lastActivityAt = this.now();
        this.userSpeaking = event.speaking;
        if (event.speaking) {
          this.heard = '';
          this.userSpokeSinceAsk = true;
        }
        this.deps.send({ type: 'user_speaking', speaking: event.speaking });
        if (!event.speaking && this.heard) this.deps.send({ type: 'heard', text: this.heard, final: true });
        return;
      case 'heard':
        this.lastActivityAt = this.now();
        this.userSpokeSinceAsk = true;
        this.heard += event.text;
        return this.deps.send({ type: 'heard', text: this.heard, final: event.finished || !this.userSpeaking });
      case 'said':
        if (this.replyEnded) {
          this.said = '';
          this.replyEnded = false;
        }
        this.said += event.text;
        this.replyOpen = true;
        return this.deps.send({ type: 'said', text: this.said });
      case 'reply_done':
        this.replyEnded = true;
        this.deps.send({ type: 'reply_done' });
        this.replaceIfReplyIsOver();
        return;
      case 'interrupted':
        this.replyEnded = true;
        return this.deps.send({ type: 'interrupted' });
      case 'tool_calls':
        this.lastActivityAt = this.now();
        this.replyOpen = true;
        for (const call of event.calls) this.onToolCall(call);
        return;
      case 'tool_calls_cancelled':
        for (const ask of this.asks.values()) if (event.ids.includes(ask.callId)) ask.awaited = false;
        // The voice model no longer waits for these: an answer from the browser would be for a call it has dropped.
        for (const [openId, open] of this.opens) if (event.ids.includes(open.callId)) this.opens.delete(openId);
        for (const [readId, callId] of this.reads) if (event.ids.includes(callId)) this.reads.delete(readId);
        return;
      case 'usage':
        this.replyOpen = false;
        this.saveUsage(event.usage, (this.replyCount += 1));
        this.replaceIfReplyIsOver();
        return;
      case 'resume_handle':
        this.resumeHandle = event.handle;
        return;
      case 'going_away':
        // A warning, not the end: a reply in progress is let finish (its words, and its usage) before the connection is replaced.
        if (this.replyOpen && !this.replaceAfterReply) {
          this.replaceAfterReply = setTimeout(() => this.replaceNow(), REPLY_GRACE_MS);
          return;
        }
        if (!this.replaceAfterReply) void this.reconnect();
        return;
      case 'closed':
        if (!event.expected) {
          this.deps.log.warn({ voiceSessionId: this.deps.sessionId, detail: event.detail }, 'assistant.voice.connection.dropped');
          void this.reconnect();
        }
        return;
    }
  }

  private onToolCall(call: VoiceToolCall): void {
    if (call.name === OPEN_PAGE_TOOL) {
      const destination = voiceDestinationSchema.safeParse((call.args as { destination?: unknown })?.destination);
      if (!destination.success) {
        this.connection?.sendToolResult({ id: call.id, name: call.name, output: { status: 'not_opened', error: 'There is no such section.' }, delivery: 'when_idle', final: true });
        return;
      }
      const openId = `open_${(this.openCount += 1)}`;
      this.opens.set(openId, { callId: call.id, name: call.name });
      this.deps.send({ type: 'open', openId, destination: destination.data });
      return;
    }
    if (call.name === READ_SCREEN_TOOL) {
      const readId = `read_${(this.readCount += 1)}`;
      this.reads.set(readId, call.id);
      this.deps.send({ type: 'read_screen', readId });
      return;
    }
    if (call.name === OPEN_ON_SCREEN_TOOL) {
      const label = (call.args as { label?: unknown })?.label;
      if (typeof label !== 'string' || !label.trim()) {
        this.connection?.sendToolResult({ id: call.id, name: call.name, output: { status: 'not_opened', error: 'Say what to open.' }, delivery: 'when_idle', final: true });
        return;
      }
      const openId = `open_${(this.openCount += 1)}`;
      this.opens.set(openId, { callId: call.id, name: call.name });
      this.deps.send({ type: 'open_link', openId, label: label.trim().slice(0, 120) });
      return;
    }
    const request = call.name === ASK_ASSISTANT_TOOL && typeof (call.args as { request?: unknown })?.request === 'string' ? (call.args as { request: string }).request.trim() : '';
    if (!request) {
      this.connection?.sendToolResult({
        id: call.id,
        name: call.name,
        output: { status: 'not_sent', error: call.name === ASK_ASSISTANT_TOOL ? 'No request was given. Ask the user what they need.' : 'There is no such tool.' },
        delivery: 'when_idle',
        final: true,
      });
      return;
    }
    if (!this.userSpokeSinceAsk) {
      this.deps.log.warn({ voiceSessionId: this.deps.sessionId }, 'assistant.voice.ask.without-speech');
      this.connection?.sendToolResult({
        id: call.id,
        name: call.name,
        output: { status: 'not_sent', error: 'Only what the user says can be passed on. Wait for the user to ask.' },
        delivery: 'silent',
        final: true,
      });
      return;
    }
    this.userSpokeSinceAsk = false;
    const askId = `ask_${(this.askCount += 1)}`;
    this.asks.set(askId, { callId: call.id, awaited: true, answered: false, watch: null });
    this.deps.send({ type: 'ask', askId, request });
  }

  /** Follows the run the browser started for a request, and tells the voice model what happens to it. */
  private async follow(askId: string, ask: Ask, turn: { conversationId: string; runId: string }): Promise<void> {
    try {
      const watch = await this.deps.watchTurn(turn, (update) =>
        this.contained(() => {
          this.lastActivityAt = this.now();
          if (update.type === 'approval') {
            this.tell(askId, { status: 'needs_approval', change_waiting_for_the_users_tap: update.change }, false);
          } else {
            this.settle(askId, resultOf(update.outcome));
          }
        }),
      );
      // The session ended, or the request was settled, while the watch was starting.
      if (this.ended || !this.asks.has(askId)) return void watch.stop();
      ask.watch = watch;
    } catch (err) {
      this.deps.log.warn({ err, voiceSessionId: this.deps.sessionId }, 'assistant.voice.turn.not-followed');
      this.contained(() => this.settle(askId, { status: 'failed', error: 'The request’s answer could not be read. It is on the screen if it finished.' }));
    }
  }

  /** Sends the news that waited for a connection, oldest first. */
  private sendNotesWhileAway(): void {
    for (const note of this.notesWhileAway.splice(0)) this.connection?.sendNote(note);
  }

  /**
   * Replaces the connection that was waiting for a reply, once that reply's
   * usage is in. It happens after the events that arrived together with the
   * usage (the end of the reply comes in the same message), so none of them is
   * taken for an old connection's.
   */
  private replaceIfReplyIsOver(): void {
    if (!this.replaceAfterReply || this.replyOpen) return;
    queueMicrotask(() =>
      this.contained(() => {
        if (this.replaceAfterReply) this.replaceNow();
      }),
    );
  }

  /** Replaces the connection now; the wait for a reply to finish, if any, is over. */
  private replaceNow(): void {
    void this.reconnect();
  }

  /** Tells the voice model the final outcome of a request and forgets it. */
  private settle(askId: string, output: Record<string, unknown>): void {
    const ask = this.asks.get(askId);
    if (!ask || this.ended) return;
    this.tell(askId, output, true);
    void ask.watch?.stop();
    this.asks.delete(askId);
    this.deps.send({ type: 'ask_done', askId });
  }

  /**
   * Tells the voice model about a request: as the tool's result while it
   * still waits for that call, otherwise as a note from the app (at once, or
   * when the connection that is being replaced is back).
   */
  private tell(askId: string, output: Record<string, unknown>, final: boolean): void {
    const ask = this.asks.get(askId);
    if (!ask) return;
    // What the assistant found is school data, which anyone may have written: see `userSpokeSinceAsk`.
    this.userSpokeSinceAsk = false;
    if (this.connection && ask.awaited) {
      this.connection.sendToolResult({ id: ask.callId, name: ASK_ASSISTANT_TOOL, output, delivery: 'when_idle', final });
      return;
    }
    const note = `${APP_NOTE_PREFIX} News about a request the user made earlier: ${JSON.stringify(output)}`;
    // While the connection is being replaced there is nobody to tell: the news waits for the new one.
    if (this.connection) this.connection.sendNote(note);
    else this.notesWhileAway.push(note);
  }

  /**
   * Replaces the connection to the voice model, continuing the session from
   * its latest resume handle. Requests still running are told as notes from
   * then on: the new connection does not know the old one's calls.
   */
  private async reconnect(): Promise<void> {
    // It runs on its own (nothing awaits it), so nothing may escape it: an unhandled rejection ends the process.
    try {
      await this.replaceConnection();
    } catch (err) {
      this.deps.log.warn({ err, voiceSessionId: this.deps.sessionId }, 'assistant.voice.reconnect.failed');
      this.contained(() => this.end('error'));
    }
  }

  private async replaceConnection(): Promise<void> {
    if (this.ended || this.reconnecting) return;
    // Whatever was waiting to replace the connection is overtaken: it is being replaced now.
    if (this.replaceAfterReply) clearTimeout(this.replaceAfterReply);
    this.replaceAfterReply = null;
    this.reconnecting = true;
    this.reconnectCount += 1;
    const old = this.connection;
    this.connection = null;
    this.connectionNumber += 1;
    try {
      old?.close();
    } catch {
      // A connection that cannot be closed is already gone.
    }
    for (const ask of this.asks.values()) ask.awaited = false;
    // The new connection never made these calls: an answer from the browser would name a call it does not know.
    this.opens.clear();
    this.reads.clear();
    this.replyOpen = false;
    this.deps.send({ type: 'reconnecting' });
    for (let attempt = 0; attempt < RECONNECT_ATTEMPTS && !this.ended; attempt += 1) {
      try {
        await this.connect();
        if (this.ended) return;
        this.reconnecting = false;
        this.deps.send({ type: 'reconnected' });
        this.sendNotesWhileAway();
        return;
      } catch (err) {
        this.deps.log.warn({ err, voiceSessionId: this.deps.sessionId, attempt }, 'assistant.voice.reconnect.failed');
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
      }
    }
    this.end('unavailable');
  }

  /** The session's own clock: its longest length, its quiet limit, and whether its user may still use voice. */
  private async tick(): Promise<void> {
    if (this.ended) return;
    const now = this.now();
    if (now - this.startedAt >= this.deps.limits.maxSessionMs) return this.contained(() => this.end('max_duration'));
    // A request that is running (or waiting for an approval) keeps the session open: its outcome is still to be said.
    if (this.asks.size === 0 && now - this.lastActivityAt >= this.deps.limits.idleMs) return this.contained(() => this.end('idle'));
    if (now - this.accessCheckedAt < ACCESS_RECHECK_MS) return;
    this.accessCheckedAt = now;
    try {
      const refusal = await this.deps.refusal();
      if (refusal) this.contained(() => this.end(refusal.reason, { message: refusal.message }));
    } catch (err) {
      // An outage of the check must not end every session; the next check decides.
      this.deps.log.warn({ err, voiceSessionId: this.deps.sessionId }, 'assistant.voice.access-recheck-failed');
    }
  }
}

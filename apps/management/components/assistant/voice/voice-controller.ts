import { ASSISTANT_PAGE_TEXT_MAX } from '@campuspilot/assistant-contract/dto';
import { ASSISTANT_VOICE_PATH, voiceServerMessageSchema, type VoiceClientMessage, type VoiceDestination, type VoiceSessionKind } from '@campuspilot/assistant-contract/voice';
import { env } from '@campuspilot/env/management.client';

import { createVoiceEngine, type VoiceEngine, type VoiceLevels } from './voice-engine';
import { noticeOfEnd, noticeOfMicError, VOICE_OFF, voiceIsOn, voiceStateAfter, type VoiceNotice, type VoiceState } from './voice-state';

/**
 * The browser's one voice session: the microphone and speakers
 * (`voice-engine.ts`), the socket to the API server
 * (`@campuspilot/assistant-contract/voice`) and the state the screen shows
 * (`voice-state.ts`).
 *
 * There is one controller for the whole app, because there is one microphone:
 * starting voice in one chat ends it in another, and a lock shared by the
 * browser's tabs keeps two tabs from talking at once. It lives outside React;
 * components read it with `useVoice` and act through its methods, from event
 * handlers only.
 */

/** A spoken request, sent as an assistant message by the chat that owns the session; resolves with the run it started. */
export type VoiceAsk = (request: string) => Promise<{ conversationId: string; runId: string }>;

/** Why something on the screen was not opened. */
export type VoiceNotOpened = { opened: false; message: string; linksOnScreen?: string[] };

/**
 * What the chat that owns the session does for it. The chat hands over a new
 * set on every render (`setHandlers`), so a request that arrives minutes into
 * a session acts on what the chat knows now (the academic session the user
 * has since switched to, the paper now shared), not on what it knew at start.
 */
export type VoiceHandlers = {
  ask: VoiceAsk;
  /**
   * Opens a section of the app on request; resolves with whether it did. Only
   * the overlay passes it: it stays on screen while the page changes under it.
   */
  open?: (destination: VoiceDestination) => Promise<{ opened: true } | VoiceNotOpened>;
  /** Follows the link on the page that matches `label`; the overlay passes it with `open`. */
  openLink?: (label: string) => Promise<{ opened: true } | VoiceNotOpened>;
  /** The page's title and text, for `read_screen`; the overlay passes it. */
  readScreen?: () => { title: string; text: string };
};

export type VoiceStartOptions = {
  /** The chat starting the session. */
  ownerId: string;
  schoolId: string;
  /** Where the session runs, which decides what the voice model may do (`voiceSessionKindSchema`). */
  kind: VoiceSessionKind;
  handlers: VoiceHandlers;
};

/** The name of the lock every tab of this browser shares: whoever holds it has the microphone. */
const TAB_LOCK = 'campuspilot-assistant-voice';

/** Microphone audio waiting to leave beyond this is dropped: on a stalled network, old speech must not arrive minutes late. */
const MAX_UNSENT_BYTES = 256 * 1024;

const ZERO_LEVELS: VoiceLevels = { input: 0, output: 0 };

function voiceUrl(schoolId: string, kind: VoiceSessionKind): string {
  const url = new URL(ASSISTANT_VOICE_PATH, env.NEXT_PUBLIC_SERVER_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('schoolId', schoolId);
  url.searchParams.set('kind', kind);
  return url.toString();
}

class VoiceController {
  private state: VoiceState = VOICE_OFF;
  private readonly listeners = new Set<() => void>();
  private engine: VoiceEngine | null = null;
  private socket: WebSocket | null = null;
  private handlers: VoiceHandlers | null = null;
  /** Releases the tab lock; set while this tab holds it. */
  private releaseLock: (() => void) | null = null;
  /** Counts sessions, so what a finished one still delivers is ignored. */
  private generation = 0;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): VoiceState => this.state;

  /** How loud the microphone and the assistant's voice are right now; zeros without a session. */
  readonly levels = (): VoiceLevels => this.engine?.levels() ?? ZERO_LEVELS;

  /**
   * Starts a session for a chat, ending any other one first. Call from the
   * user's click: browsers only open a microphone and play sound after one.
   */
  async start(options: VoiceStartOptions): Promise<void> {
    this.finish(null);
    const generation = (this.generation += 1);
    const current = () => generation === this.generation;
    this.handlers = options.handlers;
    const engine = createVoiceEngine((playing) => {
      if (current()) this.set({ ...this.state, assistantSpeaking: playing });
    });
    this.engine = engine;
    // Still inside the click: audio is allowed from here, whatever is awaited below.
    engine.prime();
    this.set({ ...VOICE_OFF, phase: 'asking', ownerId: options.ownerId });

    if (!(await this.takeTabLock())) {
      if (current()) this.finish({ tone: 'info', message: 'Voice is already on in another tab of this browser.' });
      return;
    }
    if (!current()) return this.releaseLock?.();

    try {
      await engine.start((pcm) => this.sendAudio(pcm));
    } catch (error) {
      if (current()) this.finish(noticeOfMicError(error));
      return;
    }
    if (!current()) return engine.stop();

    this.set({ ...this.state, phase: 'connecting' });
    const socket = new WebSocket(voiceUrl(options.schoolId, options.kind));
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      if (!current()) return;
      if (typeof event.data === 'string') this.onText(event.data);
      else engine.play(event.data);
    };
    // A socket that closes without the server's `ended` was never opened (refused, or the server is away) or lost its network.
    socket.onclose = () => {
      if (!current()) return;
      const neverStarted = this.state.phase === 'connecting';
      this.finish({ tone: 'problem', message: neverStarted ? 'Voice could not start. Try again in a moment.' : 'Voice lost its connection. Start it again to continue.' });
    };
    window.addEventListener('pagehide', this.end);
  }

  /** Ends the session (the user's End, or leaving the chat that owns it). */
  readonly end = (): void => {
    this.send({ type: 'end' });
    this.finish(null);
  };

  /**
   * Replaces what the owning chat does for the session with this render's
   * (see {@link VoiceHandlers}). Ignored from a chat that does not own the
   * session.
   */
  setHandlers(ownerId: string, handlers: VoiceHandlers): void {
    if (this.state.ownerId === ownerId && voiceIsOn(this.state)) this.handlers = handlers;
  }

  /** Ends the session if `ownerId`'s chat owns it: that chat is leaving the screen. */
  endFor(ownerId: string): void {
    if (this.state.ownerId === ownerId && voiceIsOn(this.state)) this.end();
  }

  /** Closes or opens the microphone. */
  setMuted(muted: boolean): void {
    if (this.state.phase === 'off' || this.state.muted === muted) return;
    this.engine?.setMuted(muted);
    this.send({ type: 'mic', open: !muted });
    this.set({ ...this.state, muted, userSpeaking: muted ? false : this.state.userSpeaking });
  }

  /** Clears the sentence that says why voice is not on. */
  dismissNotice(): void {
    if (this.state.notice) this.set({ ...this.state, notice: null });
  }

  private set(state: VoiceState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  private send(message: VoiceClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private sendAudio(pcm: ArrayBuffer): void {
    const socket = this.socket;
    // Nothing is sent before the server says the voice model is listening, or while it is being reconnected.
    if (this.state.phase !== 'live' || socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_UNSENT_BYTES) return;
    socket.send(pcm);
  }

  private onText(text: string): void {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return;
    }
    const parsed = voiceServerMessageSchema.safeParse(json);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === 'ended') return this.finish(noticeOfEnd(message.reason, message.message));
    if (message.type === 'interrupted') this.engine?.flush();
    this.set(voiceStateAfter(this.state, message));
    if (message.type === 'ask') this.passOn(message.askId, message.request);
    if (message.type === 'open') this.answerOpen(message.openId, this.handlers?.open?.(message.destination));
    if (message.type === 'open_link') this.answerOpen(message.openId, this.handlers?.openLink?.(message.label));
    if (message.type === 'read_screen') {
      const screen = this.handlers?.readScreen?.() ?? { title: '', text: '' };
      this.send({ type: 'screen', readId: message.readId, title: screen.title.slice(0, 200), text: screen.text.slice(0, ASSISTANT_PAGE_TEXT_MAX) });
    }
  }

  /**
   * Tells the server whether something was opened, once the chat has decided:
   * opening may first ask the user about unsaved changes, so the answer can
   * take as long as they do. A chat that cannot open anything (it is not the
   * overlay) answers at once.
   */
  private answerOpen(openId: string, opening: Promise<{ opened: true } | VoiceNotOpened> | undefined): void {
    const generation = this.generation;
    const answer = (result: { opened: true } | VoiceNotOpened) => {
      if (generation !== this.generation) return;
      this.send(result.opened ? { type: 'opened', openId, opened: true } : { type: 'opened', openId, opened: false, message: result.message.slice(0, 500), ...(result.linksOnScreen ? { linksOnScreen: result.linksOnScreen } : {}) });
    };
    if (!opening) return answer({ opened: false, message: 'This cannot be opened from here.' });
    opening.then(answer, () => answer({ opened: false, message: 'It could not be opened.' }));
  }

  /** Sends a spoken request as an assistant message, through the chat that owns the session, and tells the server which run it started. */
  private passOn(askId: string, request: string): void {
    const generation = this.generation;
    const ask = this.handlers?.ask;
    if (!ask) return;
    ask(request).then(
      (turn) => {
        if (generation === this.generation) this.send({ type: 'turn', askId, ...turn });
      },
      (error: unknown) => {
        if (generation !== this.generation) return;
        const message = error instanceof Error && error.message ? error.message : 'The request could not be sent.';
        this.send({ type: 'turn_failed', askId, message: message.slice(0, 500) });
      },
    );
  }

  /** Releases everything of the session and returns to `off`, keeping `notice` for the user. */
  private finish(notice: VoiceNotice | null): void {
    this.generation += 1;
    window.removeEventListener('pagehide', this.end);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.close();
    }
    this.engine?.stop();
    this.engine = null;
    this.handlers = null;
    this.releaseLock?.();
    this.releaseLock = null;
    // The notice belongs to the chat that had the session, so it is shown where voice was.
    this.set({ ...VOICE_OFF, ownerId: notice ? this.state.ownerId : null, notice });
  }

  /**
   * Takes the lock the browser's tabs share, held until the session ends.
   * False when another tab holds it. Browsers without the Web Locks API get
   * no cross-tab guard; the server still keeps one session per user.
   */
  private takeTabLock(): Promise<boolean> {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (!locks) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      void locks.request(TAB_LOCK, { ifAvailable: true }, (lock) => {
        if (!lock) return resolve(false);
        return new Promise<void>((release) => {
          this.releaseLock = release;
          resolve(true);
        });
      });
    });
  }
}

/** The app's voice session. */
export const voice = new VoiceController();

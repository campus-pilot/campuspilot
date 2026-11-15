import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import {
  ASSISTANT_VOICE_PATH,
  VOICE_MAX_INPUT_FRAME_BYTES,
  VOICE_MAX_TEXT_FRAME_BYTES,
  VOICE_UPGRADE_REFUSALS,
  voiceClientMessageSchema,
  voiceSessionKindSchema,
  type VoiceServerMessage,
  type VoiceSessionKind,
} from '@campuspilot/assistant-contract/voice';
import { env } from '@campuspilot/env/server';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import { canSee, loadAssistantAccess } from '../access';
import { mayReachConversation } from '../conversation-access';
import { db } from '../db';
import { generateId } from '../ids';
import { log } from '../log';
import { resolveAssistantSession, type AssistantSession } from '../session';
import * as store from '../store';
import { voiceRefusal } from './access';
import { voiceSettings, type VoiceSettings } from './config';
import { createGeminiLiveProvider } from './gemini-live';
import { voiceInstructions, voiceTools } from './prompt';
import type { VoiceProvider } from './provider';
import { VoiceSession, type VoiceSessionRefusal } from './session';
import { watchTurn, type TurnUpdate } from './turn-watch';
import { recordVoiceUsage } from './usage';

/**
 * Voice sessions over WebSocket at {@link ASSISTANT_VOICE_PATH} on the API
 * server (the protocol is `@campuspilot/assistant-contract/voice`).
 *
 * The upgrade request is decided before any socket exists, in this order:
 * the path, the origin, the user's session cookie, then voice access in the
 * school named in the query (`voiceRefusal`). A WebSocket handshake is not
 * subject to CORS and carries the user's cookie from any site, so the origin
 * must be one of `CORS_ORIGIN`; a request without an origin is not a browser
 * and is refused too.
 *
 * Whatever sits in front of the API must pass WebSocket upgrades on this path
 * and must not buffer it, like the assistant's event streams.
 */

/** Audio waiting to reach a slow browser beyond this is dropped, so one stuck socket cannot grow the process's memory. */
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

/** How often each socket is pinged; one that did not answer the previous ping is closed. */
const PING_MS = 30_000;

const STATUS_TEXT: Record<number, string> = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 503: 'Service Unavailable' };

/** Answers an upgrade request with a plain HTTP refusal and closes the connection. */
function refuse(socket: Duplex, status: number): void {
  if (socket.destroyed) return;
  socket.write(`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/** The request's headers as the session resolver reads them. */
function headersOf(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) for (const entry of value) headers.append(name, entry);
  }
  return headers;
}

/** The bytes of one binary frame, whichever shape `ws` delivered it in. */
function bytesOf(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}

export type AssistantVoiceOptions = {
  /** The voice model's adapter; the Gemini Live one by default. Tests pass a scripted provider. */
  createProvider?: (settings: VoiceSettings) => VoiceProvider;
};

/**
 * Serves voice sessions on `server`. Call once, after the HTTP server exists.
 * Upgrade requests for any other path are closed: nothing else on the API
 * server speaks WebSocket.
 */
export function attachAssistantVoice(server: Server, options: AssistantVoiceOptions = {}): { close: () => void } {
  const allowedOrigins = new Set(env.CORS_ORIGIN.split(',').map((origin) => origin.trim()));
  const createProvider = options.createProvider ?? createGeminiLiveProvider;
  // The socket's own limit covers the largest valid frame of either kind; each kind is held to its own limit when it arrives.
  const sockets = new WebSocketServer({ noServer: true, maxPayload: Math.max(VOICE_MAX_INPUT_FRAME_BYTES, VOICE_MAX_TEXT_FRAME_BYTES) });
  /** The open session of each user in this process: starting another ends it, so one user never has two live microphones here. */
  const sessionOfUser = new Map<string, VoiceSession>();
  /** Every session open in this process, to keep within `maxSessions`. */
  const openSessions = new Set<VoiceSession>();

  type Admitted = { session: AssistantSession; schoolId: string; kind: VoiceSessionKind; settings: VoiceSettings; headers: Headers };

  async function admit(request: IncomingMessage, url: URL): Promise<{ status: number } | Admitted> {
    const origin = request.headers.origin;
    if (!origin || !allowedOrigins.has(origin)) {
      log.warn({ origin }, 'assistant.voice.origin.refused');
      return { status: VOICE_UPGRADE_REFUSALS.forbidden };
    }
    const schoolId = url.searchParams.get('schoolId');
    const kind = voiceSessionKindSchema.safeParse(url.searchParams.get('kind'));
    if (!schoolId || !kind.success) return { status: VOICE_UPGRADE_REFUSALS.badRequest };
    const headers = headersOf(request);
    const session = await resolveAssistantSession(headers);
    if (!session) return { status: VOICE_UPGRADE_REFUSALS.signedOut };
    const access = await loadAssistantAccess(session, schoolId);
    // Someone who may not even see the assistant here learns nothing about voice.
    if (!canSee(access)) return { status: VOICE_UPGRADE_REFUSALS.forbidden };
    const settings = voiceSettings();
    const refusal = voiceRefusal(session, access, settings);
    if (refusal || !settings) return { status: refusal?.reason === 'unavailable' ? VOICE_UPGRADE_REFUSALS.noVoice : VOICE_UPGRADE_REFUSALS.forbidden };
    return { session, schoolId, kind: kind.data, settings, headers };
  }

  /**
   * Whether this process already carries as many sessions as it may. Asked
   * with nothing awaited between the answer and the session being counted
   * (`open`), so requests that were admitted at the same moment cannot all
   * take the last place. The user's own open session does not count: starting
   * again replaces it.
   */
  function isFull(admitted: Admitted): boolean {
    if (openSessions.size < admitted.settings.maxSessions || sessionOfUser.has(admitted.session.user.id)) return false;
    log.warn({ open: openSessions.size, max: admitted.settings.maxSessions }, 'assistant.voice.capacity.reached');
    return true;
  }

  /** Why the user of an open session may no longer use voice: signed out, or `voiceRefusal` now. */
  async function refusalNow(session: AssistantSession, headers: Headers, schoolId: string): Promise<VoiceSessionRefusal | null> {
    const current = await resolveAssistantSession(headers);
    if (current?.user.id !== session.user.id) return { reason: 'access', message: 'You are signed out.' };
    return voiceRefusal(current, await loadAssistantAccess(current, schoolId), voiceSettings());
  }

  /** Follows a run the browser named, once it is confirmed to be this user's own in a conversation they may read. */
  async function watchOwnTurn(session: AssistantSession, schoolId: string, turn: { conversationId: string; runId: string }, onUpdate: (update: TurnUpdate) => void) {
    const [run, conversation] = await Promise.all([
      store.findRun(db, turn.runId),
      store.findLiveConversation(db, { conversationId: turn.conversationId, schoolId }),
    ]);
    if (!run || !conversation || run.conversationId !== conversation.id || run.userId !== session.user.id || !(await mayReachConversation(session, conversation, 'read'))) {
      throw new Error('The run is not this user’s own in this school.');
    }
    return watchTurn(turn, onUpdate);
  }

  function open(socket: WebSocket, admitted: Admitted): void {
    const { session, schoolId, kind, settings, headers } = admitted;
    const sessionId = generateId('voiceSession');
    const provider = createProvider(settings);
    const send = (message: VoiceServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    const voice = new VoiceSession({
      sessionId,
      provider,
      instructions: voiceInstructions(session.user.name, kind),
      tools: voiceTools(kind),
      limits: { maxSessionMs: settings.maxSessionMs, idleMs: settings.idleMs },
      send,
      sendAudio: (pcm) => {
        if (socket.readyState === socket.OPEN && socket.bufferedAmount < MAX_BUFFERED_BYTES) socket.send(pcm, { binary: true });
      },
      closeSocket: () => socket.close(1000),
      recordUsage: (usage, reply) =>
        recordVoiceUsage(db, {
          voiceSessionId: sessionId,
          schoolId,
          userId: session.user.id,
          requestKey: `voice:${sessionId}:${reply}`,
          provider: provider.id,
          model: provider.model,
          usage,
          prices: settings.prices,
        }),
      refusal: () => refusalNow(session, headers, schoolId),
      watchTurn: (turn, onUpdate) => watchOwnTurn(session, schoolId, turn, onUpdate),
      log,
    });

    sessionOfUser.get(session.user.id)?.end('replaced');
    sessionOfUser.set(session.user.id, voice);
    openSessions.add(voice);

    let alive = true;
    const ping = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, PING_MS);
    socket.on('pong', () => {
      alive = true;
    });
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        const pcm = bytesOf(data);
        // 16-bit samples: an odd length is not audio. More than a second in one frame is not a microphone.
        if (pcm.byteLength > 0 && pcm.byteLength % 2 === 0 && pcm.byteLength <= VOICE_MAX_INPUT_FRAME_BYTES) voice.handleAudio(pcm);
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(bytesOf(data).toString());
      } catch {
        return;
      }
      const message = voiceClientMessageSchema.safeParse(parsed);
      if (message.success) voice.handleMessage(message.data);
    });
    const closed = () => {
      clearInterval(ping);
      openSessions.delete(voice);
      if (sessionOfUser.get(session.user.id) === voice) sessionOfUser.delete(session.user.id);
      voice.handleSocketClosed();
    };
    socket.on('close', closed);
    socket.on('error', closed);

    log.info({ voiceSessionId: sessionId, schoolId, userId: session.user.id, kind, model: provider.model }, 'assistant.voice.session.started');
    voice.start().catch((err: unknown) => {
      log.error({ err, voiceSessionId: sessionId }, 'assistant.voice.session.start-failed');
      voice.end('unavailable');
    });
  }

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    // Node hands over the socket with no error listener. Until `ws` takes it, a reset (a phone leaving the network
    // mid-handshake) would be an error nobody handles, which ends the process: so it is handled from the first moment.
    const dropped = () => socket.destroy();
    socket.on('error', dropped);
    let url: URL;
    try {
      // The request target is the client's own text: `//` and the like are not an address.
      url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      return socket.destroy();
    }
    if (url.pathname !== ASSISTANT_VOICE_PATH) return socket.destroy();
    // Nothing here may escape: a rejection nobody handles ends the process, and with it every school's sessions.
    admit(request, url)
      .then((admitted) => {
        if ('status' in admitted) return refuse(socket, admitted.status);
        if (isFull(admitted)) return refuse(socket, VOICE_UPGRADE_REFUSALS.busy);
        // `ws` listens for the socket's errors itself from here.
        socket.off('error', dropped);
        sockets.handleUpgrade(request, socket, head, (ws) => {
          try {
            open(ws, admitted);
          } catch (err) {
            log.error({ err }, 'assistant.voice.session.not-built');
            ws.terminate();
          }
        });
      })
      .catch((err: unknown) => {
        log.error({ err }, 'assistant.voice.upgrade.failed');
        // The socket may be gone, or already upgraded: it is only closed, never written to.
        socket.destroy();
      });
  };
  server.on('upgrade', onUpgrade);

  return {
    close: () => {
      server.off('upgrade', onUpgrade);
      for (const voice of [...openSessions]) voice.end('restarting');
      sockets.close();
    },
  };
}

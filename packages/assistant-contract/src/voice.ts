import { z } from 'zod';

import { ASSISTANT_PAGE_TEXT_MAX } from './dto';

/**
 * Voice mode's wire format between the management app and the API server.
 *
 * A voice session is one WebSocket at {@link ASSISTANT_VOICE_PATH} on the API
 * origin, opened with the user's CampusPilot session cookie and the school in
 * the query (`?schoolId=`). The server relays it to the voice model, so the
 * model's key, its instructions and its usage never reach the browser.
 *
 * - **Binary frames** are audio: raw 16-bit little-endian mono PCM, at
 *   {@link VOICE_INPUT_SAMPLE_RATE} from the browser (the microphone) and at
 *   {@link VOICE_OUTPUT_SAMPLE_RATE} from the server (the assistant's voice).
 * - **Text frames** are JSON: {@link voiceClientMessageSchema} from the browser,
 *   {@link voiceServerMessageSchema} from the server.
 *
 * The voice model only listens and speaks. It holds no school data and has one
 * tool, "ask the assistant": the server passes each request to the browser
 * (`ask`), the browser sends it as an ordinary assistant message through
 * `/model/rpc/sendMessage` and answers with the run it started (`turn`), and
 * the server tells the voice model how that run ended. So a spoken request is
 * a normal turn: same permissions, same approvals on screen, same history.
 */

/** Where the API server accepts voice sessions (WebSocket upgrade only). */
export const ASSISTANT_VOICE_PATH = '/model/voice';

/** Sample rate of the microphone audio the browser sends, in Hz. */
export const VOICE_INPUT_SAMPLE_RATE = 16_000;

/** Sample rate of the assistant's voice the server sends, in Hz. */
export const VOICE_OUTPUT_SAMPLE_RATE = 24_000;

/** The largest audio frame the server accepts from the browser: one second of microphone audio. */
export const VOICE_MAX_INPUT_FRAME_BYTES = VOICE_INPUT_SAMPLE_RATE * 2;

/**
 * The largest text frame the server accepts from the browser, in bytes. The
 * biggest valid one is `screen` with a full page text, whose limit is counted
 * in characters: a character of Devanagari is three bytes in UTF-8, and JSON
 * may escape a character into six. This leaves room for both.
 */
export const VOICE_MAX_TEXT_FRAME_BYTES = ASSISTANT_PAGE_TEXT_MAX * 6 + 4_096;

/**
 * What a session is attached to, said by the browser when it opens it (`kind`
 * in the query):
 * - `overlay`: the layer over the app. It can open pages and read the page
 *   under it, so the voice model is given those tools.
 * - `chat`: the voice button inside a chat's own message box (the Assistant
 *   page, the palette, a question paper's screen). It lives and dies with that
 *   chat, so it cannot leave the page or read it: the voice model is given
 *   only "ask the assistant".
 */
export const voiceSessionKindSchema = z.enum(['overlay', 'chat']);
export type VoiceSessionKind = z.infer<typeof voiceSessionKindSchema>;

/**
 * Why a session ended, as the server reports it:
 * - `ended`: the user ended it.
 * - `replaced`: the user started voice in another window, which took over.
 * - `restarting`: the server is restarting; voice can be started again.
 * - `idle`: nobody spoke and nothing was running for the idle limit.
 * - `max_duration`: the session reached its longest allowed length.
 * - `limit_reached`: the school reached its monthly assistant limit.
 * - `access`: the user may no longer use voice here (signed out, role or
 *   feature switched off).
 * - `unavailable`: the voice model could not be reached or refused.
 * - `error`: anything else.
 */
export const voiceEndReasonSchema = z.enum(['ended', 'replaced', 'restarting', 'idle', 'max_duration', 'limit_reached', 'access', 'unavailable', 'error']);
export type VoiceEndReason = z.infer<typeof voiceEndReasonSchema>;

/**
 * The places of the app the assistant may open on request, by section. A fixed
 * list, never a free address: the browser builds the real path for the school
 * and session the user is in, and the page itself still decides what the user
 * may see. Opening one record (a student, a class) is not in this list.
 */
export const VOICE_DESTINATIONS = ['dashboard', 'assistant', 'staff', 'admission', 'classroom', 'examinations', 'documents', 'billing', 'notices', 'settings'] as const;
export const voiceDestinationSchema = z.enum(VOICE_DESTINATIONS);
export type VoiceDestination = z.infer<typeof voiceDestinationSchema>;

/** What the browser sends as text frames. */
export const voiceClientMessageSchema = z.discriminatedUnion('type', [
  /**
   * The microphone was closed (`open: false`, the user muted) or opened again.
   * While it is closed the browser sends no audio at all; this only tells the
   * voice model the stream paused, so it finishes what it heard.
   */
  z.object({ type: z.literal('mic'), open: z.boolean() }),
  /** The browser sent the request of `ask` as a message; this is the run it started. */
  z.object({ type: z.literal('turn'), askId: z.string().min(1), conversationId: z.string().min(1), runId: z.string().min(1) }),
  /** The browser could not send the request of `ask` (refused, offline); `message` is what the user was shown. */
  z.object({ type: z.literal('turn_failed'), askId: z.string().min(1), message: z.string().max(500) }),
  /** The browser opened the page of `open` (`opened: true`), or could not (`message` says why). */
  z.object({
    type: z.literal('opened'),
    openId: z.string().min(1),
    opened: z.boolean(),
    message: z.string().max(300).optional(),
    /** For `open_link` that found no match: the links that are on the screen, by their text, so the voice model can pick one or say it is not there. */
    linksOnScreen: z.array(z.string().max(120)).max(40).optional(),
  }),
  /**
   * The answer to `read_screen`: the page's title and its text (as
   * `pageContext.pageText`), or no text when this surface cannot read one.
   */
  z.object({ type: z.literal('screen'), readId: z.string().min(1), title: z.string().max(200), text: z.string().max(ASSISTANT_PAGE_TEXT_MAX) }),
  /** The user ended the session. */
  z.object({ type: z.literal('end') }),
]);
export type VoiceClientMessage = z.infer<typeof voiceClientMessageSchema>;

/** What the server sends as text frames. */
export const voiceServerMessageSchema = z.discriminatedUnion('type', [
  /** The voice model is connected: the browser may start sending audio. */
  z.object({ type: z.literal('ready'), sessionId: z.string(), maxSeconds: z.number().int().positive() }),
  /** The voice model heard the user start (`true`) or stop (`false`) speaking. */
  z.object({ type: z.literal('user_speaking'), speaking: z.boolean() }),
  /** What the user has said in the current utterance so far; `final` once they stopped. */
  z.object({ type: z.literal('heard'), text: z.string(), final: z.boolean() }),
  /** What the assistant has said in its current reply so far. */
  z.object({ type: z.literal('said'), text: z.string() }),
  /** The assistant finished its reply (all its audio has been sent). */
  z.object({ type: z.literal('reply_done') }),
  /** The user spoke over the assistant: stop playing what was sent and drop what is queued. */
  z.object({ type: z.literal('interrupted') }),
  /** Send `request` as an assistant message and answer with `turn` or `turn_failed`. */
  z.object({ type: z.literal('ask'), askId: z.string(), request: z.string() }),
  /** Open this section of the app and answer with `opened`. */
  z.object({ type: z.literal('open'), openId: z.string(), destination: voiceDestinationSchema }),
  /**
   * Follow the link on the user's screen whose text best matches `label` (an
   * exam's card, a student's row) and answer with `opened`. Only a link that
   * is on the screen now, in this school, is ever followed: the same as the
   * user clicking it.
   */
  z.object({ type: z.literal('open_link'), openId: z.string(), label: z.string().min(1).max(120) }),
  /** Read the text of the page under the overlay and answer with `screen`. */
  z.object({ type: z.literal('read_screen'), readId: z.string() }),
  /** The run of `ask` ended and the voice model has been told. */
  z.object({ type: z.literal('ask_done'), askId: z.string() }),
  /** The connection to the voice model dropped and is being restored; audio is not heard meanwhile. */
  z.object({ type: z.literal('reconnecting') }),
  z.object({ type: z.literal('reconnected') }),
  /** The session is over; the server closes the socket after this. */
  z.object({ type: z.literal('ended'), reason: voiceEndReasonSchema, message: z.string() }),
]);
export type VoiceServerMessage = z.infer<typeof voiceServerMessageSchema>;

/**
 * HTTP statuses the upgrade request is refused with, before any socket
 * exists: 400 a request that is not a voice session's, 401 signed out, 403
 * another origin or not allowed (no access to the assistant, at the limit,
 * voice switched off for the school, impersonating), 404 the platform has no
 * voice model, 503 this server is carrying all the sessions it may. The
 * browser cannot read them from a failed WebSocket, so it asks `getStatus`
 * first and treats a failed open as "try again".
 */
export const VOICE_UPGRADE_REFUSALS = { badRequest: 400, signedOut: 401, forbidden: 403, noVoice: 404, busy: 503 } as const;

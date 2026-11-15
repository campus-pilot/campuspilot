'use client';

import { useId, useRef, useState } from 'react';

import { useVoice } from './use-voice';
import { voice, type VoiceHandlers } from './voice-controller';
import { createVoiceConversation, type VoiceConversation } from './voice-conversation';
import { voiceActivityOf, voiceIsOn } from './voice-state';

/** A spoken request sent as this chat's message; resolves with the conversation and run it belongs to. */
export type ChatVoiceSend = (request: string, conversationId: string | null) => Promise<{ conversationId: string; runId: string }>;

/** The owner of the overlay's session. Fixed, so the overlay's chat can tell its own session before it renders anything of it. */
export const OVERLAY_VOICE_OWNER = 'assistant-voice-overlay';

/**
 * Voice mode for one chat. Every assistant surface renders the same chat
 * (`AssistantChat`), so this is the one place voice is wired, and all of them
 * get it.
 *
 * The app has one voice session (`voice-controller.ts`); a chat only shows it
 * while it owns it. A spoken request is sent with the chat's own `send`, into
 * the conversation the session is in: the one the session started in, or the
 * one its first request starts (`onConversationStarted` then moves the chat
 * to it, exactly as a typed first message does).
 */
export function useChatVoice(input: {
  schoolId: string;
  /** The conversation open in the chat now; null before its first message. */
  conversationId: string | null;
  send: ChatVoiceSend;
  onConversationStarted: (conversationId: string) => void;
  /**
   * What only the overlay's chat can do: move the user's screen and read the
   * page under it. Its presence is what makes a session an `overlay` one; a
   * chat inside a page passes none and gets a `chat` session, whose voice
   * model is not offered those tools.
   */
  overlay?: Pick<VoiceHandlers, 'open' | 'openLink' | 'readScreen'>;
}) {
  const generatedId = useId();
  const ownerId = input.overlay ? OVERLAY_VOICE_OWNER : generatedId;
  const state = useVoice();
  const mine = state.ownerId === ownerId;
  // Stable for the chat's life: React re-runs a ref whose function changed, which would end the session on every render.
  const [leave] = useState(() => () => voice.endFor(ownerId));
  /**
   * The conversation of the session this chat started last
   * (`voice-conversation.ts`). The session's own record: the chat's value is a
   * render behind when requests follow each other, and it belongs to whatever
   * the chat shows, which a new session must not inherit. Written only from
   * the click that starts voice.
   */
  const session = useRef<VoiceConversation | null>(null);

  const handlers: VoiceHandlers = {
    ...input.overlay,
    ask: async (request) => {
      const own = session.current;
      if (!own) throw new Error('Voice is not on in this chat.');
      return own.send(request, input.send, (conversationId) => {
        // A request of a session that has since been replaced still gets its answer, but it no longer moves the chat.
        if (session.current === own) input.onConversationStarted(conversationId);
      });
    },
  };

  /**
   * Starts voice in this chat. Call from the click itself. The session
   * continues the conversation open in the chat, or a new one when
   * `conversationId` is given as null (the overlay: every session is a new
   * conversation).
   */
  const start = (options: { conversationId?: null } = {}) => {
    session.current = createVoiceConversation('conversationId' in options ? null : input.conversationId);
    void voice.start({ ownerId, schoolId: input.schoolId, kind: input.overlay ? 'overlay' : 'chat', handlers });
  };

  /**
   * Gives the session this render's handlers. A ref for an element of the
   * chat: React runs it after every render that commits (the function is new
   * each time), which is the moment the chat's values are current, with no
   * effect.
   */
  const handlersRef = (element: Element | null) => {
    if (element) voice.setHandlers(ownerId, handlers);
  };

  return {
    /** Whether this chat shows voice mode now. */
    on: mine && voiceIsOn(state),
    state,
    activity: voiceActivityOf(state),
    /** Why voice is not on in this chat, when it ended on its own or could not start. */
    notice: mine ? state.notice : null,
    levels: voice.levels,
    start,
    handlersRef,
    end: voice.end,
    setMuted: (muted: boolean) => voice.setMuted(muted),
    dismissNotice: () => voice.dismissNotice(),
    /** Ends this chat's session; for the cleanup of the chat's root element. */
    leave,
  };
}

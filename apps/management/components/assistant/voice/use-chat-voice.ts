'use client';

import type { VoiceDestination } from '@campuspilot/assistant-contract/voice';
import { useId, useState } from 'react';

import { useVoice } from './use-voice';
import { voice } from './voice-controller';
import { voiceActivityOf, voiceIsOn } from './voice-state';

/** A spoken request sent as this chat's message; resolves with the conversation and run it belongs to. */
export type ChatVoiceSend = (request: string, conversationId: string | null) => Promise<{ conversationId: string; runId: string }>;

/**
 * Voice mode for one chat. Every assistant surface renders the same chat
 * (`AssistantChat`), so this is the one place voice is wired, and all of them
 * get it.
 *
 * The app has one voice session (`voice-controller.ts`); a chat only shows it
 * while it owns it. A spoken request is sent with the chat's own `send`, into
 * the conversation the session is in: the one open when voice started, or the
 * one its first request starts (`onConversationStarted` then moves the chat
 * to it, exactly as a typed first message does).
 */
export function useChatVoice(input: {
  schoolId: string;
  /** The conversation open in the chat now; null before its first message. */
  conversationId: string | null;
  send: ChatVoiceSend;
  onConversationStarted: (conversationId: string) => void;
  /** Opens a section of the app on request (the overlay's chat only). */
  open?: (destination: VoiceDestination) => boolean;
  /** Follows a link on the screen by its text (the overlay's chat only). */
  openLink?: (label: string) => { opened: true } | { opened: false; linksOnScreen: string[] };
  /** Reads the page under the overlay (the overlay's chat only). */
  readScreen?: () => { title: string; text: string };
}) {
  const ownerId = useId();
  const state = useVoice();
  const mine = state.ownerId === ownerId;
  // Stable for the chat's life: React re-runs a ref whose function changed, which would end the session on every render.
  const [leave] = useState(() => () => voice.endFor(ownerId));

  /** Starts voice in this chat. Call from the click itself. */
  const start = () => {
    // The session's own record of its conversation: the chat's value is a render behind when requests follow each other.
    let conversationId = input.conversationId;
    void voice.start({
      ownerId,
      schoolId: input.schoolId,
      open: input.open,
      openLink: input.openLink,
      readScreen: input.readScreen,
      ask: async (request) => {
        const turn = await input.send(request, conversationId);
        if (!conversationId) {
          conversationId = turn.conversationId;
          input.onConversationStarted(turn.conversationId);
        }
        return turn;
      },
    });
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
    end: voice.end,
    setMuted: (muted: boolean) => voice.setMuted(muted),
    dismissNotice: () => voice.dismissNotice(),
    /** Ends this chat's session; for the cleanup of the chat's root element. */
    leave,
  };
}

'use client';

import type { VoiceDestination } from '@campuspilot/assistant-contract/voice';
import { AssistantVoiceButtonIcon } from '@campuspilot/components/assistant';
import { Button } from '@campuspilot/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { cn } from '@campuspilot/ui/lib/utils';
import { useParams, useRouter } from 'next/navigation';

import { useSchoolSessions, useStoredSchoolSessionId } from '@/components/session-selection';
import { confirmNavigation } from '@/lib/navigation-guard';

import { AssistantAccess } from '../assistant-access';
import { AssistantChat } from '../assistant-chat';
import { useAssistantStatus } from '../use-assistant';
import { useVoice } from './use-voice';
import { voice, type VoiceNotOpened } from './voice-controller';
import { bestLink, closestLinks, linkTexts, nearestFirst, screenLinks } from './screen-links';
import { voiceDestinationHref } from './voice-destinations';
import { launchVoice } from './voice-launcher';
import { voiceIsOn } from './voice-state';

/**
 * The assistant as a layer over the app: a voice bar docked at the bottom of
 * the window, with the conversation in a card above it once something was
 * asked, and a glow around the window while it is on. The page underneath
 * stays visible and usable: the layer takes no clicks except on its own bar
 * and card.
 *
 * It is mounted in the school's layout, above every page and both shells
 * (workspace and settings), so a session survives all navigation inside the
 * school, including the navigation the assistant does itself (`open`). Leaving
 * the school unmounts it and ends the session, which belongs to that school.
 *
 * It renders the same chat as every other assistant surface (`AssistantChat`
 * in its `overlay` mode), so a spoken request, its steps, its tables and its
 * approvals are the chat's own.
 */
export function AssistantVoiceOverlay({ schoolId }: { schoolId: string }) {
  return (
    <AssistantAccess schoolId={schoolId}>
      <OverlayLayer schoolId={schoolId} />
    </AssistantAccess>
  );
}

/** The session the user is in: the address's, else the one they last chose, else the active one (as the workspace layout decides). */
function useSelectedSessionId(schoolId: string): string | null {
  const params = useParams();
  const routeSessionId = String(params.sessionId ?? '') || null;
  const stored = useStoredSchoolSessionId(schoolId);
  const sessions = useSchoolSessions(schoolId);
  return routeSessionId ?? stored ?? sessions.data?.find((session) => session.isActive)?.id ?? null;
}

/** Marks the overlay, so what it shows is never taken for the page (its own links are not opened by name). */
const OVERLAY_ATTRIBUTE = 'data-assistant-overlay';

function OverlayLayer({ schoolId }: { schoolId: string }) {
  const router = useRouter();
  const sessionId = useSelectedSessionId(schoolId);
  const on = voiceIsOn(useVoice());
  /**
   * Whether the page may be left. The assistant moving the screen is the app
   * navigating on its own, like switching school or session, so an editor with
   * unsaved changes is asked first (its own dialog) and the user's answer is
   * awaited: a spoken "open fees" must never throw away a half-filled form.
   */
  const mayLeave = async (): Promise<VoiceNotOpened | null> =>
    (await confirmNavigation()) ? null : { opened: false, message: 'The user has unsaved changes on this page and chose to stay on it.' };
  /**
   * Opens what matches `label` on the page (`open_on_screen`): its links, the
   * sidebar, the breadcrumbs, anything the user could click to move, except
   * the overlay itself.
   */
  const openLink = async (label: string) => {
    const onScreen = screenLinks(document.body, schoolId, `[${OVERLAY_ATTRIBUTE}]`);
    const link = bestLink(label, onScreen.links);
    if (!link) {
      // Several places fit what was said: the user is asked which, the model does not pick.
      const close = closestLinks(label, onScreen.links);
      return close.length
        ? { opened: false as const, message: `Several things on the page match "${label}". Ask the user which one they mean.`, linksOnScreen: linkTexts(close) }
        : { opened: false as const, message: `Nothing on the page matches "${label}".`, linksOnScreen: linkTexts(nearestFirst(label, onScreen.links)) };
    }
    const stay = await mayLeave();
    if (stay) return stay;
    onScreen.follow(link, (href) => router.push(href));
    return { opened: true as const };
  };
  const open = async (destination: VoiceDestination) => {
    const href = voiceDestinationHref(destination, { schoolId, sessionId });
    if (!href) return { opened: false as const, message: 'This section cannot be opened from here.' };
    const stay = await mayLeave();
    if (stay) return stay;
    router.push(href);
    return { opened: true as const };
  };
  return (
    <>
      {/* The glow says voice is on wherever the user looks: a thin ring round the window, and light rising from the pill. The pill says what it is doing in words. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none fixed inset-0 z-40 transition-opacity duration-500 motion-reduce:transition-none',
          'shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,#c2580e_50%,transparent),inset_0_0_36px_color-mix(in_oklab,#c2580e_18%,transparent)]',
          'bg-[radial-gradient(70%_38%_at_50%_100%,color-mix(in_oklab,#c2580e_26%,transparent),transparent)]',
          on ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div {...{ [OVERLAY_ATTRIBUTE]: '' }} className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
        <div className="pointer-events-auto w-full max-w-2xl">
          <AssistantChat
            // One chat for the school: the overlay starts a new conversation with each session itself.
            schoolId={schoolId}
            conversationId={null}
            surface="panel"
            compact
            onConversationStarted={() => undefined}
            onNewConversation={() => undefined}
            overlay={{
              open,
              openLink,
            }}
          />
        </div>
      </div>
    </>
  );
}

/**
 * The top bar's assistant button: it starts voice in the overlay, and ends it
 * when it is on. Shown to someone who can have a voice session in the school
 * now (`getStatus().voice.available`); typing lives on the Assistant page.
 */
export function AssistantVoiceLauncher({ schoolId }: { schoolId: string }) {
  return (
    <AssistantAccess schoolId={schoolId}>
      <LauncherButton schoolId={schoolId} />
    </AssistantAccess>
  );
}

function LauncherButton({ schoolId }: { schoolId: string }) {
  const status = useAssistantStatus(schoolId);
  const on = voiceIsOn(useVoice());
  if (status.data?.voice.available !== true) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={on ? 'secondary' : 'ghost'}
          size="icon"
          aria-label={on ? 'End voice' : 'Talk to the assistant'}
          aria-pressed={on}
          onClick={() => (on ? voice.end() : launchVoice())}
        >
          <AssistantVoiceButtonIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{on ? 'End voice' : 'Talk to the assistant'}</TooltipContent>
    </Tooltip>
  );
}

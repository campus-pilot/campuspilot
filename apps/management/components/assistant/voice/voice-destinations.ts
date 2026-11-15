import type { VoiceDestination } from '@campuspilot/assistant-contract/voice';

import { schoolHref, schoolSessionHref } from '@/components/school-route';

/** The sections that live inside an academic session; the others belong to the school. */
const SESSION_SECTIONS: Partial<Record<VoiceDestination, string>> = {
  dashboard: '',
  classroom: '/classroom',
  examinations: '/exam',
  documents: '/documents',
  billing: '/billing',
  notices: '/notices',
};

const SCHOOL_SECTIONS: Partial<Record<VoiceDestination, string>> = {
  assistant: '/assistant',
  staff: '/staff',
  admission: '/admission',
  settings: '/settings',
};

/**
 * The address of a section the assistant may open (`VOICE_DESTINATIONS`), in
 * the school and the session the user is in; the same addresses the sidebar
 * links to. Null for a session section while no session is selected. The page
 * decides what the user may see there, as for any link.
 */
export function voiceDestinationHref(destination: VoiceDestination, place: { schoolId: string; sessionId: string | null }): string | null {
  const schoolSection = SCHOOL_SECTIONS[destination];
  if (schoolSection !== undefined) return schoolHref(place.schoolId, schoolSection);
  const sessionSection = SESSION_SECTIONS[destination];
  if (sessionSection === undefined || !place.sessionId) return null;
  return schoolSessionHref(place.schoolId, place.sessionId, sessionSection);
}

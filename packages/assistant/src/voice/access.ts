import type { SchoolKind } from '@campuspilot/db/school-kind';

import type { AssistantAccessDecision } from '../access';
import type { AssistantSession } from '../session';
import type { VoiceSettings } from './config';
import type { VoiceSessionRefusal } from './session';

/**
 * Why the user cannot have a voice session in the school now, or null when
 * they can. Voice only narrows the assistant: every fact below is its own
 * check, on top of the one access decision the assistant already makes
 * (`resolveAssistantAccess`), and the first that fails is returned.
 *
 * 1. the platform has a voice model configured;
 * 2. the user may send in the school now (feature, role, monthly limit);
 * 3. the school's assistant feature has voice switched on;
 * 4. nobody is impersonating the user: an impersonating administrator gets no
 *    delegated token, so a spoken request could never start a turn;
 * 5. the school is not a personal space (`school.kind`, its own fact; read
 *    with `readSchoolKind`): a personal space has no voice mode
 *    (docs/personal-space.md), whatever its assistant settings say. Checked
 *    first after the platform's own setup, so it never depends on them.
 */
export function voiceRefusal(
  session: AssistantSession,
  access: AssistantAccessDecision,
  settings: VoiceSettings | null,
  schoolKind: SchoolKind | null,
): VoiceSessionRefusal | null {
  if (!settings) return { reason: 'unavailable', message: 'Voice is not set up on this platform.' };
  if (schoolKind === 'personal') return { reason: 'access', message: 'Voice is not available in a personal space.' };
  if (!access.allowed) {
    return {
      reason: access.refusal?.code === 'limit_reached' ? 'limit_reached' : 'access',
      message: access.refusal?.message ?? 'You cannot use the AI assistant in this school.',
    };
  }
  if (!access.voiceEnabled) return { reason: 'access', message: 'Voice is not switched on for this school.' };
  if (session.user.impersonatedBy) return { reason: 'access', message: 'Voice is not available while impersonating a user.' };
  return null;
}

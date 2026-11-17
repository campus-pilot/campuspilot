import type { Context } from '@campuspilot/api/context';
import { describe, expect, it } from 'vitest';

import type { AssistantAccessDecision } from '../access';
import type { AssistantSession } from '../session';
import { voiceRefusal } from './access';
import type { VoiceSettings } from './config';

const SETTINGS: VoiceSettings = {
  apiKey: 'key',
  model: 'voice-test-model',
  voiceName: null,
  prices: { textInputUsdPerMtok: '1', audioInputUsdPerMtok: '1', textOutputUsdPerMtok: '1', audioOutputUsdPerMtok: '1' },
  maxSessionMs: 60_000,
  idleMs: 60_000,
  maxSessions: 5_000,
};

const ALLOWED: AssistantAccessDecision = {
  featureEnabled: true,
  member: true,
  allowedRoles: ['teacher'],
  suspended: false,
  limit: { known: true, monthlyLimitUsd: null },
  limitReached: false,
  voiceEnabled: true,
  allowed: true,
  refusal: null,
};

const session = (impersonatedBy: string | null = null): AssistantSession => ({
  user: { id: 'u1', name: 'Asha Rao', email: 'asha@school.test', impersonatedBy },
  context: {} as Context,
});

describe('voiceRefusal', () => {
  it('allows voice when the platform has a voice model, the user may send and the school has voice on', () => {
    expect(voiceRefusal(session(), ALLOWED, SETTINGS)).toBeNull();
  });

  it('says voice is not set up when the platform has no voice model, whatever the school has', () => {
    expect(voiceRefusal(session(), ALLOWED, null)).toEqual({ reason: 'unavailable', message: 'Voice is not set up on this platform.' });
  });

  it('gives the assistant’s own refusal first, and names the monthly limit as its own reason', () => {
    const atLimit: AssistantAccessDecision = { ...ALLOWED, limitReached: true, allowed: false, refusal: { code: 'limit_reached', message: 'The school reached its limit.' } };
    expect(voiceRefusal(session(), atLimit, SETTINGS)).toEqual({ reason: 'limit_reached', message: 'The school reached its limit.' });
    const noRole: AssistantAccessDecision = { ...ALLOWED, allowedRoles: [], allowed: false, refusal: { code: 'role_not_enabled', message: 'Your role cannot use the AI assistant.' } };
    expect(voiceRefusal(session(), noRole, SETTINGS)).toEqual({ reason: 'access', message: 'Your role cannot use the AI assistant.' });
  });

  it('refuses a suspended school with the assistant’s own refusal: a read-only school starts no turn, spoken or typed', () => {
    const suspended: AssistantAccessDecision = {
      ...ALLOWED,
      suspended: true,
      allowed: false,
      refusal: { code: 'school_suspended', message: 'This school is suspended.' },
    };
    expect(voiceRefusal(session(), suspended, SETTINGS)).toEqual({ reason: 'access', message: 'This school is suspended.' });
  });

  it('refuses a school whose assistant has voice switched off: the assistant alone never grants voice', () => {
    expect(voiceRefusal(session(), { ...ALLOWED, voiceEnabled: false }, SETTINGS)).toEqual({ reason: 'access', message: 'Voice is not switched on for this school.' });
  });

  it('refuses an impersonating administrator, who could never start a turn', () => {
    expect(voiceRefusal(session('adm_1'), ALLOWED, SETTINGS)?.reason).toBe('access');
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { VOICE_DESTINATIONS } from '@campuspilot/assistant-contract/voice';

import { voiceDestinationHref } from './voice-destinations';

describe('voiceDestinationHref', () => {
  const place = { schoolId: 'sch_1', sessionId: 'sess_1' };

  it('gives the sidebar’s own address for school and session sections', () => {
    assert.equal(voiceDestinationHref('staff', place), '/school/sch_1/staff');
    assert.equal(voiceDestinationHref('settings', place), '/school/sch_1/settings');
    assert.equal(voiceDestinationHref('dashboard', place), '/school/sch_1/sessions/sess_1');
    assert.equal(voiceDestinationHref('billing', place), '/school/sch_1/sessions/sess_1/billing');
    assert.equal(voiceDestinationHref('examinations', place), '/school/sch_1/sessions/sess_1/exam');
  });

  it('has an address for every destination the assistant may name', () => {
    for (const destination of VOICE_DESTINATIONS) assert.ok(voiceDestinationHref(destination, place), destination);
  });

  it('opens no session section while no session is selected, and still opens school sections', () => {
    assert.equal(voiceDestinationHref('billing', { schoolId: 'sch_1', sessionId: null }), null);
    assert.equal(voiceDestinationHref('staff', { schoolId: 'sch_1', sessionId: null }), '/school/sch_1/staff');
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { noticeOfEnd, noticeOfMicError, VOICE_OFF, voiceActivityOf, voiceIsOn, voiceStateAfter, type VoiceState } from './voice-state';

const LIVE: VoiceState = { ...VOICE_OFF, phase: 'live', ownerId: 'chat1' };

describe('voiceActivityOf', () => {
  it('shows one thing at a time, a closed microphone before anything it could not hear', () => {
    assert.equal(voiceActivityOf({ ...LIVE, phase: 'asking' }), 'starting');
    assert.equal(voiceActivityOf({ ...LIVE, phase: 'connecting' }), 'starting');
    assert.equal(voiceActivityOf({ ...LIVE, phase: 'reconnecting', muted: true }), 'reconnecting');
    assert.equal(voiceActivityOf({ ...LIVE, muted: true, userSpeaking: true, assistantSpeaking: true, working: 1 }), 'muted');
    assert.equal(voiceActivityOf({ ...LIVE, userSpeaking: true, assistantSpeaking: true, working: 1 }), 'hearing');
    assert.equal(voiceActivityOf({ ...LIVE, assistantSpeaking: true, working: 1 }), 'speaking');
    assert.equal(voiceActivityOf({ ...LIVE, working: 2 }), 'working');
    assert.equal(voiceActivityOf(LIVE), 'listening');
  });
});

describe('voiceStateAfter', () => {
  it('goes live when the server is ready, and back to live after a reconnect', () => {
    const connecting: VoiceState = { ...LIVE, phase: 'connecting' };
    const live = voiceStateAfter(connecting, { type: 'ready', sessionId: 'avs_1', maxSeconds: 1200 });
    assert.equal(live.phase, 'live');
    const dropped = voiceStateAfter({ ...live, userSpeaking: true }, { type: 'reconnecting' });
    assert.partialDeepStrictEqual(dropped, { phase: 'reconnecting', userSpeaking: false });
    assert.equal(voiceStateAfter(dropped, { type: 'reconnected' }).phase, 'live');
  });

  it('replaces the last utterance’s words when the user starts speaking again', () => {
    const heard = voiceStateAfter(LIVE, { type: 'heard', text: 'Class 8-B ki report', final: true });
    assert.partialDeepStrictEqual(heard, { heard: 'Class 8-B ki report', heardFinal: true });
    const again = voiceStateAfter(heard, { type: 'user_speaking', speaking: true });
    assert.partialDeepStrictEqual(again, { userSpeaking: true, heard: '', heardFinal: false });
    // Stopping keeps what was heard.
    const stopped = voiceStateAfter({ ...again, heard: 'aur 7-A' }, { type: 'user_speaking', speaking: false });
    assert.partialDeepStrictEqual(stopped, { userSpeaking: false, heard: 'aur 7-A' });
  });

  it('counts the requests that are with the assistant, never below none', () => {
    const one = voiceStateAfter(LIVE, { type: 'ask', askId: 'ask_1', request: 'x' });
    const two = voiceStateAfter(one, { type: 'ask', askId: 'ask_2', request: 'y' });
    assert.equal(two.working, 2);
    assert.equal(voiceStateAfter(two, { type: 'ask_done', askId: 'ask_1' }).working, 1);
    assert.equal(voiceStateAfter(LIVE, { type: 'ask_done', askId: 'ask_9' }).working, 0);
  });

  it('keeps what the assistant said after its reply ends, and when it is interrupted', () => {
    const said = voiceStateAfter(LIVE, { type: 'said', text: 'There are 11 students.' });
    assert.equal(voiceStateAfter(said, { type: 'reply_done' }).said, 'There are 11 students.');
    assert.equal(voiceStateAfter(said, { type: 'interrupted' }), said);
  });
});

describe('ending', () => {
  it('says nothing when the user ended voice, and why when it ended on its own', () => {
    // The reason decides, never the wording: the server may say it differently tomorrow.
    assert.equal(noticeOfEnd('ended', 'Voice ended.'), null);
    assert.equal(noticeOfEnd('ended', 'You ended voice.'), null);
    assert.deepEqual(noticeOfEnd('replaced', 'Voice continued in another window.'), { tone: 'info', message: 'Voice continued in another window.' });
    assert.deepEqual(noticeOfEnd('restarting', 'Voice ended.'), { tone: 'info', message: 'Voice ended.' });
    assert.equal(noticeOfEnd('idle', 'Voice ended because it was quiet for a while.')?.tone, 'info');
    assert.deepEqual(noticeOfEnd('limit_reached', 'The school reached its limit.'), { tone: 'problem', message: 'The school reached its limit.' });
    assert.equal(noticeOfEnd('unavailable', 'Voice is not available right now.')?.tone, 'problem');
  });

  it('tells a refused microphone from a missing one', () => {
    assert.ok(noticeOfMicError(new DOMException('denied', 'NotAllowedError')).message.includes('not allowed'));
    assert.ok(noticeOfMicError(new DOMException('none', 'NotFoundError')).message.includes('No microphone'));
    assert.equal(noticeOfMicError(new Error('boom')).message, 'The microphone could not be started. Try again.');
  });

  it('is on from the permission prompt until it ends', () => {
    assert.equal(voiceIsOn(VOICE_OFF), false);
    assert.equal(voiceIsOn({ ...VOICE_OFF, notice: { tone: 'info', message: 'x' }, ownerId: 'chat1' }), false);
    for (const phase of ['asking', 'connecting', 'live', 'reconnecting'] as const) assert.equal(voiceIsOn({ ...LIVE, phase }), true);
  });
});

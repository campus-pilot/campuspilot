import { schoolMonthSpendUsd } from '@campuspilot/api/assistant/spend';
import { assistantModelRequestTable } from '@campuspilot/db/schema/assistant';
import { getRedisClient } from '@campuspilot/redis/client';
import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '../db';
import { generateId } from '../ids';
import { createTestSchool } from '../testing/school';
import { recordVoiceUsage } from './usage';

/** A voice reply's cost rows against the real table: its constraint, its cost arithmetic and the school's spend. */
const PRICES = { textInputUsdPerMtok: '0.75', audioInputUsdPerMtok: '3.00', textOutputUsdPerMtok: '4.50', audioOutputUsdPerMtok: '12.00' };

async function record(usage: { textInputTokens: number; audioInputTokens: number; textOutputTokens: number; audioOutputTokens: number }, reply = 1) {
  const schoolId = await createTestSchool();
  const voiceSessionId = generateId('voiceSession');
  const input = { voiceSessionId, schoolId, userId: 'usr_voice', requestKey: `voice:${voiceSessionId}:${reply}`, provider: 'gemini' as const, model: 'voice-test-model', usage, prices: PRICES };
  await recordVoiceUsage(db, input);
  const rows = () => db.select().from(assistantModelRequestTable).where(eq(assistantModelRequestTable.voiceSessionId, voiceSessionId)).orderBy(asc(assistantModelRequestTable.requestKey));
  return { schoolId, voiceSessionId, input, rows };
}

describe('recordVoiceUsage', () => {
  it('saves a reply as one row per modality, each at its own prices, with the exact cost', async () => {
    const { rows, schoolId, voiceSessionId } = await record({ textInputTokens: 441, audioInputTokens: 308, textOutputTokens: 90, audioOutputTokens: 89 });
    const [audio, text] = await rows();
    expect(audio).toMatchObject({
      source: 'voice',
      runId: null,
      questionPaperJobId: null,
      schoolId,
      requestKey: `voice:${voiceSessionId}:1:audio`,
      provider: 'gemini',
      requestedModel: 'voice-test-model',
      answeredModel: 'voice-test-model',
      usageComplete: true,
      inputTokens: 308,
      outputTokens: 89,
      inputUsdPerMtok: '3.000000',
      outputUsdPerMtok: '12.000000',
      // (308 × 3 + 89 × 12) ÷ 1,000,000
      costUsd: '0.00199200',
    });
    expect(text).toMatchObject({
      requestKey: `voice:${voiceSessionId}:1:text`,
      inputTokens: 441,
      outputTokens: 90,
      inputUsdPerMtok: '0.750000',
      outputUsdPerMtok: '4.500000',
      // (441 × 0.75 + 90 × 4.5) ÷ 1,000,000
      costUsd: '0.00073575',
    });
  });

  it('counts toward the school’s monthly spend, like every other model request', async () => {
    const { schoolId } = await record({ textInputTokens: 1_000_000, audioInputTokens: 0, textOutputTokens: 0, audioOutputTokens: 1_000_000 });
    // The sum is cached; this school is new, so the first read computes it.
    await getRedisClient().flushdb();
    expect(Number(await schoolMonthSpendUsd(db, schoolId))).toBeCloseTo(12.75, 8);
  });

  it('saves no row for a modality without tokens, and nothing for an empty reply', async () => {
    const onlyText = await record({ textInputTokens: 100, audioInputTokens: 0, textOutputTokens: 21, audioOutputTokens: 0 });
    expect((await onlyText.rows()).map((row) => row.requestKey.split(':').at(-1))).toEqual(['text']);
    const empty = await record({ textInputTokens: 0, audioInputTokens: 0, textOutputTokens: 0, audioOutputTokens: 0 });
    expect(await empty.rows()).toEqual([]);
  });

  it('saves a reply once, however often it is recorded', async () => {
    const { rows, input } = await record({ textInputTokens: 10, audioInputTokens: 10, textOutputTokens: 10, audioOutputTokens: 10 });
    await recordVoiceUsage(db, input);
    expect(await rows()).toHaveLength(2);
  });

  it('is refused by the table without a voice session: a voice row belongs to one', async () => {
    const schoolId = await createTestSchool();
    await expect(
      db.insert(assistantModelRequestTable).values({
        source: 'voice',
        schoolId,
        userId: 'usr_voice',
        requestKey: `voice:none:${Date.now()}`,
        provider: 'gemini',
        requestedModel: 'm',
        answeredModel: 'm',
        usageComplete: true,
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        inputUsdPerMtok: '1',
        outputUsdPerMtok: '1',
        cacheReadUsdPerMtok: '0',
        cacheWriteUsdPerMtok: '0',
        costUsd: '0',
      }),
    ).rejects.toThrow();
  });
});

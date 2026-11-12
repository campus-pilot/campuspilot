import { db } from '@campuspilot/db';
import { examQuestionPaperJobTable, examQuestionPaperTable } from '@campuspilot/db/schema/exam-question-paper';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createQuestionPaperWorld, type QuestionPaperWorld } from '../../../test/question-paper';
import { env } from '@campuspilot/env/assistant';
import {
  dispatchQuestionPaperJob,
  QUESTION_PAPER_HANDOVER_DEADLINE_MS,
  QUESTION_PAPER_START_DEADLINE_MS,
  sweepQuestionPaperOutbox,
} from './outbox';

/**
 * Restate is replaced by a controllable fake. Jobs of other test files that
 * share this database (a sweep sees every school's rows) always fail to hand
 * over here, with the error an unsigned deployment gives, so this file can
 * never mark another file's job as handed over.
 */
const restate = vi.hoisted(() => ({ mine: new Set<string>(), fail: false, sent: [] as Array<[string, number]> }));
vi.mock('./restate', () => ({
  sendQuestionPaperStart: vi.fn(async (jobId: string, attempt: number) => {
    if (!restate.mine.has(jobId)) throw new Error('WORKER_CONTROL_SECRET is not set, so worker control calls cannot be signed.');
    if (restate.fail) throw new Error('connect ECONNREFUSED 127.0.0.1:8080');
    restate.sent.push([jobId, attempt]);
    return { invocationId: `inv_${jobId}` };
  }),
}));

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

describe('question paper outbox', () => {
  let world: QuestionPaperWorld;
  let counter = 0;
  beforeEach(async () => {
    world = world ?? (await createQuestionPaperWorld());
    restate.fail = false;
    restate.sent.length = 0;
  });

  /** A job of its own paper (only one job per paper may be in flight). */
  async function job(values: Partial<typeof examQuestionPaperJobTable.$inferInsert>) {
    counter += 1;
    const [paper] = await db
      .insert(examQuestionPaperTable)
      .values({ ...world.key({ subjectSlug: `outbox-${counter}` }), createdBy: world.people.manager.userId })
      .returning();
    const [row] = await db
      .insert(examQuestionPaperJobTable)
      .values({ paperId: paper!.id, schoolId: world.schoolId, requestedBy: world.people.manager.userId, pageIds: [], pageRevision: 0, ...values })
      .returning();
    restate.mine.add(row!.id);
    return row!;
  }
  const reload = async (id: string) => (await db.select().from(examQuestionPaperJobTable).where(eq(examQuestionPaperJobTable.id, id)))[0]!;

  it('hands a queued job over once, with its attempt, and never sends it again', async () => {
    const queued = await job({ attempt: 2 });
    expect(await dispatchQuestionPaperJob(db, queued.id)).toBe(true);
    expect(restate.sent).toEqual([[queued.id, 2]]);
    expect(await reload(queued.id)).toMatchObject({ status: 'queued', handoverAttempts: 1, lastHandoverError: null, handedOverAt: expect.any(Date) });
    expect(await dispatchQuestionPaperJob(db, queued.id)).toBe(false);
    await sweepQuestionPaperOutbox(db);
    expect(restate.sent).toEqual([[queued.id, 2]]);
  });

  it('records why a hand-over failed and keeps trying on the next sweep', async () => {
    const queued = await job({});
    restate.fail = true;
    await sweepQuestionPaperOutbox(db);
    expect(await reload(queued.id)).toMatchObject({ status: 'queued', handedOverAt: null, handoverAttempts: 1, lastHandoverError: 'Restate is unreachable.' });
    restate.fail = false;
    await sweepQuestionPaperOutbox(db);
    expect(await reload(queued.id)).toMatchObject({ status: 'queued', handedOverAt: expect.any(Date), handoverAttempts: 2, lastHandoverError: null });
  });

  it('fails a job Restate has not accepted for ten minutes, visibly', async () => {
    const stuck = await job({ createdAt: new Date(Date.now() - QUESTION_PAPER_HANDOVER_DEADLINE_MS - 60_000) });
    const fresh = await job({ createdAt: minutesAgo(9) });
    restate.fail = true;
    await sweepQuestionPaperOutbox(db);
    expect(await reload(stuck.id)).toMatchObject({ status: 'failed', errorCode: 'dispatch_failed', errorMessage: 'AI generation could not be started. Try again.', completedAt: expect.any(Date) });
    expect(await reload(fresh.id)).toMatchObject({ status: 'queued', errorCode: null });
    expect(restate.sent).toEqual([]);
  });

  it('fails a job the worker never started within five minutes of acceptance', async () => {
    const accepted = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    const late = await job({ handedOverAt: new Date(Date.now() - QUESTION_PAPER_START_DEADLINE_MS - 60_000), handoverAttempts: 1 });
    const waiting = await job({ handedOverAt: accepted(4), handoverAttempts: 1 });
    const started = await job({ handedOverAt: accepted(20), startedAt: accepted(19), status: 'running', handoverAttempts: 1 });
    await sweepQuestionPaperOutbox(db);
    expect(await reload(late.id)).toMatchObject({ status: 'failed', errorCode: 'not_started', errorMessage: 'AI generation did not start. Try again.' });
    expect(await reload(waiting.id)).toMatchObject({ status: 'queued' });
    expect(await reload(started.id)).toMatchObject({ status: 'running' });
  });

  it('fails a running job that exceeded the timeout, and leaves finished jobs alone', async () => {
    const hung = await job({ status: 'running', handedOverAt: minutesAgo(200), startedAt: minutesAgo(env.QUESTION_PAPER_JOB_TIMEOUT_MINUTES + 1), handoverAttempts: 1 });
    const working = await job({ status: 'running', handedOverAt: minutesAgo(20), startedAt: minutesAgo(env.QUESTION_PAPER_JOB_TIMEOUT_MINUTES - 5), handoverAttempts: 1 });
    const done = await job({ status: 'succeeded', completedAt: minutesAgo(500), startedAt: minutesAgo(501), handedOverAt: minutesAgo(502) });
    const failedEarlier = await job({ status: 'failed', errorCode: 'model_busy', errorMessage: 'busy', completedAt: minutesAgo(500), startedAt: minutesAgo(501), handedOverAt: minutesAgo(502) });
    const counts = await sweepQuestionPaperOutbox(db);
    expect(counts.notFinished).toBeGreaterThanOrEqual(1);
    expect(await reload(hung.id)).toMatchObject({ status: 'failed', errorCode: 'not_finished', errorMessage: 'AI generation took too long. Try again.' });
    expect(await reload(working.id)).toMatchObject({ status: 'running' });
    expect(await reload(done.id)).toMatchObject({ status: 'succeeded', errorCode: null });
    expect(await reload(failedEarlier.id)).toMatchObject({ status: 'failed', errorCode: 'model_busy', errorMessage: 'busy' });
  });

  it('allows only one job in flight per paper', async () => {
    const first = await job({});
    await expect(
      db.insert(examQuestionPaperJobTable).values({ paperId: first.paperId, schoolId: world.schoolId, requestedBy: first.requestedBy, pageIds: [], pageRevision: 0 }),
    ).rejects.toThrow();
    await db.update(examQuestionPaperJobTable).set({ status: 'failed', errorCode: 'x', completedAt: new Date() }).where(eq(examQuestionPaperJobTable.id, first.id));
    await expect(
      db.insert(examQuestionPaperJobTable).values({ paperId: first.paperId, schoolId: world.schoolId, requestedBy: first.requestedBy, pageIds: [], pageRevision: 0 }),
    ).resolves.toBeDefined();
  });
});

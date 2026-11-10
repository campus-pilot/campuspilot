import * as restate from '@restatedev/restate-sdk';
import { describe, expect, it, vi } from 'vitest';

import { createFakeRunContext, SimulatedCrash } from './run-context';

/**
 * The turn tests are only as good as this fake's likeness to Restate, so the
 * behaviours they lean on are pinned here.
 */
describe('fake run context', () => {
  it('runs a step once and returns its result as the journal would store it', async () => {
    const ctx = createFakeRunContext();
    const action = vi.fn(async () => ({ at: new Date('2026-11-10T00:00:00.000Z'), skipped: undefined }));
    // A Date does not survive Restate's JSON journal; neither does it here.
    expect(await ctx.run('step', action, { maxRetryAttempts: 3 })).toEqual({ at: '2026-11-10T00:00:00.000Z' });
    expect(action).toHaveBeenCalledTimes(1);
    expect(ctx.journal).toEqual([
      { kind: 'run', name: 'step', outcome: { status: 'ok', value: { at: '2026-11-10T00:00:00.000Z' } } },
    ]);
  });

  it('retries a thrown error and returns the first success', async () => {
    const ctx = createFakeRunContext();
    const action = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('flaky')).mockResolvedValue('ok');
    expect(await ctx.run('step', action, { maxRetryAttempts: 3 })).toBe('ok');
    expect(ctx.attempts('step')).toBe(2);
  });

  it('gives up after maxRetryAttempts attempts with a terminal error carrying the last message', async () => {
    const ctx = createFakeRunContext();
    let attempt = 0;
    const action = vi.fn(async () => {
      throw new Error(`failure ${++attempt}`);
    });
    const failure = await ctx.run('step', action, { maxRetryAttempts: 3 }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(restate.TerminalError);
    expect((failure as Error).message).toBe('failure 3');
    expect(action).toHaveBeenCalledTimes(3);
  });

  it('does not retry a terminal error and keeps only its message', async () => {
    const ctx = createFakeRunContext();
    const thrown = Object.assign(new restate.TerminalError('stop here'), { extra: 'lost' });
    const action = vi.fn(async () => {
      throw thrown;
    });
    const failure = await ctx.run('step', action, { maxRetryAttempts: 5 }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(restate.TerminalError);
    expect(failure).not.toBe(thrown);
    expect((failure as Error).message).toBe('stop here');
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('replays recorded steps without running them and executes the rest', async () => {
    const first = createFakeRunContext();
    await first.run('a', async () => 1, { maxRetryAttempts: 1 });
    await first.run('b', async () => { throw new restate.TerminalError('b failed'); }, { maxRetryAttempts: 1 }).catch(() => {});

    const replay = createFakeRunContext({ journal: first.journal });
    const a = vi.fn(async () => 99);
    const b = vi.fn(async () => 99);
    expect(await replay.run('a', a, { maxRetryAttempts: 1 })).toBe(1);
    await expect(replay.run('b', b, { maxRetryAttempts: 1 })).rejects.toThrow('b failed');
    expect(await replay.run('c', async () => 3, { maxRetryAttempts: 1 })).toBe(3);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(replay.replayed).toEqual(['a', 'b']);
    expect(replay.executed).toEqual(['c']);
    expect(first.journal).toHaveLength(2);
    expect(replay.journal).toHaveLength(3);
  });

  it('fails a replay whose steps do not line up with the journal', async () => {
    const first = createFakeRunContext();
    await first.run('a', async () => 1, { maxRetryAttempts: 1 });
    const replay = createFakeRunContext({ journal: first.journal });
    await expect(replay.run('renamed', async () => 1, { maxRetryAttempts: 1 })).rejects.toThrow(/Journal mismatch/);
  });

  it('crashes after a step ran, leaving it out of the journal so a replay runs it again', async () => {
    const first = createFakeRunContext();
    first.crashAfter('b');
    const b = vi.fn(async () => 2);
    await first.run('a', async () => 1, { maxRetryAttempts: 1 });
    await expect(first.run('b', b, { maxRetryAttempts: 5 })).rejects.toBeInstanceOf(SimulatedCrash);
    // The invocation is dead: nothing else runs on it.
    await expect(first.run('c', async () => 3, { maxRetryAttempts: 1 })).rejects.toBeInstanceOf(SimulatedCrash);
    expect(b).toHaveBeenCalledTimes(1);

    const replay = createFakeRunContext({ journal: first.journal });
    await replay.run('a', async () => 99, { maxRetryAttempts: 1 });
    expect(await replay.run('b', b, { maxRetryAttempts: 5 })).toBe(2);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('resolves awakeables from the test and replays their resolution', async () => {
    const first = createFakeRunContext();
    const waiting = first.awakeable<{ decision: string }>();
    expect(first.pendingAwakeables()).toEqual([waiting.id]);
    first.resolveAwakeable(waiting.id, { decision: 'approve' });
    expect(await waiting.promise).toEqual({ decision: 'approve' });
    expect(first.pendingAwakeables()).toEqual([]);

    const replay = createFakeRunContext({ journal: first.journal });
    const again = replay.awakeable<{ decision: string }>();
    expect(again.id).toBe(waiting.id);
    expect(await again.promise).toEqual({ decision: 'approve' });
  });

  it('keeps an unresolved awakeable waiting across a replay', async () => {
    const first = createFakeRunContext();
    const { id } = first.awakeable<string>();
    const replay = createFakeRunContext({ journal: first.journal });
    const again = replay.awakeable<string>();
    expect(again.id).toBe(id);
    replay.resolveAwakeable(id, 'late');
    expect(await again.promise).toBe('late');
  });
});

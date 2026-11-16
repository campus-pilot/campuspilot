import type { DatabaseExecutor } from '@campuspilot/db';
import { describe, expect, it, vi } from 'vitest';

// The auth instance is not needed to write a password; keep this a unit test.
// `setup.ts` ends `authDb`'s pool after every file, so the stand-in needs one.
vi.mock('../server', () => ({
  auth: {},
  authDb: { $client: { end: async () => {} } },
}));

const { setStaffPassword } = await import('../staff-login');

/**
 * A stand-in transaction that records the order of statements, enough to
 * see whether the user row is locked before the credential is written.
 */
function recordingExecutor() {
  const statements: string[] = [];
  const chain = (name: string, result: unknown) => {
    const node: Record<string, unknown> = {};
    for (const step of ['from', 'set', 'where', 'values']) {
      node[step] = () => node;
    }
    node.for = (strength: string) => {
      statements.push(`${name} for ${strength}`);
      return Promise.resolve(result);
    };
    node.returning = () => {
      statements.push(name);
      return Promise.resolve(result);
    };
    node.then = (resolve: (value: unknown) => void) => {
      statements.push(name);
      resolve(result);
    };
    return node;
  };
  const executor = {
    select: () => chain('select user', [{ id: 'user-1' }]),
    update: () => chain('update credential', []),
    insert: () => chain('insert credential', undefined),
  };
  return { executor: executor as unknown as DatabaseExecutor, statements };
}

describe('setStaffPassword', () => {
  it('locks the user row before creating a first credential', async () => {
    const { executor, statements } = recordingExecutor();
    await setStaffPassword(executor, { userId: 'user-1', password: 'happy-tiger-27' });
    expect(statements).toEqual([
      'select user for update',
      'update credential',
      'insert credential',
    ]);
  });
});

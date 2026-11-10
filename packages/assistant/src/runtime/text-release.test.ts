import { describe, expect, it } from 'vitest';

import { createTextRelease } from './text-release';

function harness() {
  let clock = 0;
  const out: Array<{ offset: number; delta: string }> = [];
  const update = createTextRelease({ publish: ({ offset, delta }) => out.push({ offset, delta }), now: () => clock });
  return { out, update, tick: (ms: number) => (clock += ms) };
}

describe('createTextRelease', () => {
  it('releases whole lines, in order, as deltas', () => {
    const { out, update } = harness();
    update('Hello wor');
    update('Hello world\nNext');
    update('Hello world\nNext line\n');
    expect(out).toEqual([
      { offset: 0, delta: 'Hello world\n' },
      { offset: 12, delta: 'Next line\n' },
    ]);
  });

  it('lets a long line flow by whole words after a short hold', () => {
    const { out, update, tick } = harness();
    update('A long sentence that keeps go');
    tick(500);
    update('A long sentence that keeps going on');
    expect(out).toEqual([{ offset: 0, delta: 'A long sentence that keeps going ' }]);
  });

  it('never releases a partial line inside an open code fence', () => {
    const { out, update, tick } = harness();
    update('```ts\nconst a = 1;\nconst b');
    tick(1000);
    update('```ts\nconst a = 1;\nconst bee = ');
    expect(out).toEqual([{ offset: 0, delta: '```ts\nconst a = 1;\n' }]);
  });
});

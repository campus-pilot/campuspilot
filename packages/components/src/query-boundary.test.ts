import { describe, expect, it } from 'vitest';

import { resolveQueryBoundary } from './query-boundary';

/** Review round 2, R2U1: what is already on screen survives a failed refetch. */
describe('resolveQueryBoundary', () => {
  const network = new Error('Failed to fetch');
  const notFound = Object.assign(new Error('Notice was not found.'), { code: 'NOT_FOUND' });
  const replaces = (error: unknown) => (error as { code?: string }).code === 'NOT_FOUND';

  it('is pending until the first answer and failed when the first read fails', () => {
    expect(resolveQueryBoundary({ data: undefined, error: null })).toEqual({ kind: 'pending' });
    expect(resolveQueryBoundary({ data: undefined, error: undefined })).toEqual({ kind: 'pending' });
    expect(resolveQueryBoundary({ data: undefined, error: network })).toEqual({ kind: 'failed', error: network });
  });

  it('keeps the data it holds when a refetch fails, and reports the failed refresh beside it', () => {
    expect(resolveQueryBoundary({ data: { title: 'Draft' }, error: null })).toEqual({ kind: 'ready', data: { title: 'Draft' }, refetchError: null });
    expect(resolveQueryBoundary({ data: { title: 'Draft' }, error: network })).toEqual({ kind: 'ready', data: { title: 'Draft' }, refetchError: network });
    expect(resolveQueryBoundary({ data: { title: 'Draft' }, error: network }, { replaces })).toEqual({ kind: 'ready', data: { title: 'Draft' }, refetchError: network });
  });

  it('lets an error that makes the held data untrue replace it', () => {
    expect(resolveQueryBoundary({ data: { title: 'Draft' }, error: notFound }, { replaces })).toEqual({ kind: 'failed', error: notFound });
    // Without a rule nothing replaces held data.
    expect(resolveQueryBoundary({ data: { title: 'Draft' }, error: notFound })).toMatchObject({ kind: 'ready' });
  });

  it('treats null and empty values as data: only undefined means nothing is held', () => {
    expect(resolveQueryBoundary<null>({ data: null, error: network })).toEqual({ kind: 'ready', data: null, refetchError: network });
    expect(resolveQueryBoundary<string[]>({ data: [], error: network })).toMatchObject({ kind: 'ready', data: [] });
  });
});

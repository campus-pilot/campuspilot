import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSessionUser } from './platform';

const user = { id: 'usr_1', name: 'Meera', email: 'meera@example.test' };

/** Answers every fetch with `status` and `body`, and counts the calls. */
function answer(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getSessionUser', () => {
  it('returns the user the API reports', async () => {
    answer(200, { user, session: {} });
    await expect(getSessionUser('cookie=signed-in')).resolves.toEqual(user);
  });

  it('returns null when the API says nobody is signed in', async () => {
    answer(200, null);
    await expect(getSessionUser('cookie=signed-out')).resolves.toBeNull();
  });

  it.each([502, 503, 429])('throws instead of reporting "signed out" when the API answers %s', async (status) => {
    answer(status, { message: 'unavailable' });
    await expect(getSessionUser(`cookie=outage-${status}`)).rejects.toThrow(String(status));
  });

  it('does not remember an outage: the next check asks the API again', async () => {
    answer(503, {});
    await expect(getSessionUser('cookie=recovering')).rejects.toThrow();
    const fetch = answer(200, { user, session: {} });
    await expect(getSessionUser('cookie=recovering')).resolves.toEqual(user);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

import { env } from '@campuspilot/env/server';
import { describe, expect, it } from 'vitest';

import { ASSISTANT_RPC_PREFIX, createAssistantRequestHandler } from './http';

const allowed = env.CORS_ORIGIN.split(',')[0]!.trim();

/** A call of the assistant's API, as a browser on `origin` would send it (no cookie). */
const send = (origin: string | null) =>
  createAssistantRequestHandler()(
    new Request(`http://api.invalid${ASSISTANT_RPC_PREFIX}/getStatus`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      body: JSON.stringify({ json: { schoolId: 'sch_1' } }),
    }),
  );

describe('requests from other sites', () => {
  it('are refused before they reach any procedure', async () => {
    const response = await send('https://elsewhere.example');
    expect(response?.status).toBe(403);
  });

  it.each([
    ['the app’s own origin', allowed],
    ['no origin (not a browser on another site)', null],
  ])('pass on to the sign-in check from %s', async (_label, origin) => {
    // Without a session cookie, the next check refuses them as signed out.
    const response = await send(origin);
    expect(response?.status).toBe(401);
  });

  it('answers nothing for a path that is no procedure', async () => {
    const response = await createAssistantRequestHandler()(
      new Request(`http://api.invalid${ASSISTANT_RPC_PREFIX}/noSuchProcedure`, { method: 'POST' }),
    );
    expect(response).toBeNull();
  });
});

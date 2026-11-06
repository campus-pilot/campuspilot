import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { app as serverApp } from './http';
import { createRateLimit } from './rate-limit';

/** A one-route app limited like `/blob/*`, under a test-only Redis namespace. */
function limitedApp(options: { limit: number; windowMs: number }) {
  const app = new Hono();
  app.use(
    '/limited/*',
    createRateLimit({ id: `test-${crypto.randomUUID()}`, ...options }),
  );
  app.get('/limited/ping', (context) => context.text('ok'));
  return app;
}

/** Fresh IPs per test, so counters from other tests never collide. */
const uniqueIp = () => `198.51.100.1-${crypto.randomUUID()}`;

const call = (app: Hono, ip: string) =>
  app.request('/limited/ping', { headers: { 'x-real-ip': ip } });

async function burst(app: Hono, ip: string, count: number) {
  const statuses: number[] = [];
  for (let index = 0; index < count; index += 1) {
    statuses.push((await call(app, ip)).status);
  }
  return statuses;
}

describe('createRateLimit', () => {
  it('allows the limit within a window and rejects the next request with 429', async () => {
    const app = limitedApp({ limit: 20, windowMs: 60_000 });
    const ip = uniqueIp();

    const statuses = await burst(app, ip, 20);
    const rejected = await call(app, ip);

    expect(statuses).toEqual(Array(20).fill(200));
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get('retry-after')).toBeTruthy();
    expect(rejected.headers.get('ratelimit-policy')).toBe('20;w=60');
    expect(await rejected.json()).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('starts a fresh allowance once the window expires', async () => {
    const app = limitedApp({ limit: 2, windowMs: 300 });
    const ip = uniqueIp();
    expect(await burst(app, ip, 3)).toEqual([200, 200, 429]);

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect((await call(app, ip)).status).toBe(200);
  });

  it('counts each client IP separately', async () => {
    const app = limitedApp({ limit: 1, windowMs: 60_000 });
    const busyIp = uniqueIp();
    await call(app, busyIp);

    expect((await call(app, busyIp)).status).toBe(429);
    expect((await call(app, uniqueIp())).status).toBe(200);
  });

  it('limits the public logo blob to 20 requests per second per IP', async () => {
    const ip = uniqueIp();
    const statuses: number[] = [];
    for (let index = 0; index < 21; index += 1) {
      const response = await serverApp.request(
        '/blob/school/sch_does_not_exist/logo?size=192',
        { headers: { 'x-real-ip': ip } },
      );
      statuses.push(response.status);
    }

    // Requests 1–20 reach the handler (404: unknown school); the 21st is
    // limited. 21 local requests finish well inside the one-second window.
    expect(statuses.slice(0, 20)).toEqual(Array(20).fill(404));
    expect(statuses[20]).toBe(429);
  });
});

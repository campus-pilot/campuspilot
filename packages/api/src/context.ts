import { auth } from '@campuspilot/auth/server';
import { db } from '@campuspilot/db';
import type { Context as HonoContext } from 'hono';

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });
  return {
    db,
    session,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

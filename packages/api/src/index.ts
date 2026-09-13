import { os } from "@orpc/server";

import type { Context } from "./context";
import { rpcError } from "./errors";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw rpcError.unauthorized();
  }
  return next({
    context: {
      db: context.db,
      session: context.session,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);

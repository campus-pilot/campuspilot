import { os } from "@orpc/server";

import type { Context } from "./context";
import { rpcError } from "./errors";
import type { ProcedureMeta } from "./mcp-metadata";

export const o = os.$context<Context>().$meta<ProcedureMeta>({});

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

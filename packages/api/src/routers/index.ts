import type { RouterClient } from '@orpc/server';

import { publicProcedure } from '../index';
import { authRouter } from './auth/auth.router';
import { authorizationRouter } from './authorization/authorization.router';
import { personalSpaceRouter } from './personal-space/personal-space.router';
import { schoolRouter } from './school/school.router';
import { schoolCreationRouter } from './school-creation/school-creation.router';
import { systemAdminRouter } from './system-admin/system-admin.router';

const healthCheck = publicProcedure
  .route({
    summary: 'Check API health',
    description:
      'Return a simple availability response. This public procedure does not require authentication.',
    tags: ['System'],
  })
  .meta({
    mcp: {
      exposure: 'hidden',
      access: 'read',
      destructive: false,
      module: 'system',
    },
  })
  .handler(() => {
    return 'OK';
  });

/**
 * The router's shape, written out by name: the API package emits
 * declarations, and the router inferred as one literal is more than the
 * compiler will serialize. Naming each part lets the declaration refer to the
 * parts instead of repeating them.
 */
type AppRouterShape = {
  auth: typeof authRouter;
  authorization: typeof authorizationRouter;
  healthCheck: typeof healthCheck;
  personalSpace: typeof personalSpaceRouter;
  school: typeof schoolRouter;
  schoolCreation: typeof schoolCreationRouter;
  systemAdmin: typeof systemAdminRouter;
};

export const appRouter: AppRouterShape = {
  auth: authRouter,
  authorization: authorizationRouter,
  healthCheck,
  personalSpace: personalSpaceRouter,
  school: schoolRouter,
  schoolCreation: schoolCreationRouter,
  systemAdmin: systemAdminRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;

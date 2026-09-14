import type { RouterClient } from '@orpc/server';

import { publicProcedure } from '../index';
import { schoolRouter } from './school/school.router';
import { systemAdminRouter } from './system-admin/system-admin.router';

export const appRouter = {
  healthCheck: publicProcedure
    .route({
      summary: 'Check API health',
      description:
        'Return a simple availability response. This public procedure does not require authentication.',
      tags: ['System'],
    })
    .handler(() => {
      return 'OK';
    }),
  school: schoolRouter,
  systemAdmin: systemAdminRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;

import { admissionTable } from '@campuspilot/db/schema/admission';
import type { RouterClient } from '@orpc/server';
import { eq } from 'drizzle-orm';

import { cadetProcedure } from '../../cadet/procedure';
import { rpcError, toRpcError } from '../../errors';
import {
  admissionDtoSchema,
  toAdmissionDto,
} from '../school/admission/admission.dto';

/**
 * The Cadet Portal's router. It is deliberately not part of `appRouter`, so
 * staff RPC, OpenAPI and MCP can never list or reach these procedures, and
 * cadet transports can never reach staff ones. Every leaf declares MCP
 * metadata like `appRouter` leaves; the cadet MCP catalog is built from it.
 */
export const cadetRouter = {
  getAdmission: cadetProcedure
    .route({
      summary: 'Get my admission',
      description:
        "Get the signed-in student's own admission record (name, admission number, class, contact and parents' details). Takes no input: the student is identified by the sign-in.",
      tags: ['Cadet'],
    })
    .meta({
      mcp: {
        exposure: 'core',
        access: 'read',
        destructive: false,
        module: 'account',
      },
    })
    .output(admissionDtoSchema)
    .handler(async ({ context }) => {
      try {
        const [admission] = await context.db
          .select()
          .from(admissionTable)
          .where(eq(admissionTable.id, context.cadet.admissionId))
          .limit(1);
        if (!admission) throw rpcError.notFound('Admission');
        return toAdmissionDto(admission);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};

export type CadetRouter = typeof cadetRouter;
export type CadetRouterClient = RouterClient<typeof cadetRouter>;

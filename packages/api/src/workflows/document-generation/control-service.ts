import { db } from '@campuspilot/db';
import { documentGenerationJobTable } from '@campuspilot/db/schema/document-generation-job';
import * as restate from '@restatedev/restate-sdk';
import { and, eq, inArray } from 'drizzle-orm';

import { authenticateControlCall } from '../control-service-auth';
import { DOCUMENT_GENERATION_CONTROL_SERVICE_NAME, type DocumentGenerationControlHandler } from './constants';
import { documentGenerationJobInputSchema, type DocumentGenerationJobInput } from './input';
import { log } from './log';
import { documentGenerationObject } from './object';

/**
 * `DocumentGenerationControl` is the only document generation service
 * reachable through Restate ingress; the object that runs jobs is
 * `ingressPrivate`. The API hands a queued job over with a one-way,
 * idempotent, signed send (the outbox in `outbox.ts`), so no request waits
 * for the worker. `startGeneration` is, in order: Zod-parsed (malformed input
 * fails terminally at once), authenticated by its HMAC signature
 * (`WORKER_CONTROL_SECRET`, bound to this service and handler), checked
 * against the database (the job exists and is queued or running), and only
 * then queues the job on its school's object. It trusts the caller with
 * nothing but the job id: the school comes from the job row.
 */
export const documentGenerationControlService = restate.service({
  name: DOCUMENT_GENERATION_CONTROL_SERVICE_NAME,
  handlers: {
    startGeneration: async (ctx: restate.Context, rawInput: DocumentGenerationJobInput): Promise<{ invocationId: string }> => {
      const parsed = documentGenerationJobInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid document generation request.', { errorCode: 400 });
      const input = parsed.data;
      const handler: DocumentGenerationControlHandler = 'startGeneration';
      await authenticateControlCall(ctx, { service: DOCUMENT_GENERATION_CONTROL_SERVICE_NAME, handler, input, log });
      const schoolId = await ctx.run(
        'validate-job',
        async () => {
          try {
            const [job] = await db
              .select({ schoolId: documentGenerationJobTable.schoolId })
              .from(documentGenerationJobTable)
              .where(and(eq(documentGenerationJobTable.id, input.jobId), inArray(documentGenerationJobTable.status, ['queued', 'running'])))
              .limit(1);
            return job?.schoolId ?? null;
          } catch (error) {
            log.error({ service: DOCUMENT_GENERATION_CONTROL_SERVICE_NAME, err: error instanceof Error ? error.name : 'unknown' }, 'document-generation.control.error');
            throw new Error('A database operation failed; the worker log has the details.');
          }
        },
        { maxRetryAttempts: 5 },
      );
      if (!schoolId) throw new restate.TerminalError('No queued or running document job has this id.', { errorCode: 409 });
      const handle = ctx.objectSendClient(documentGenerationObject, schoolId).generate(input);
      return { invocationId: await handle.invocationId };
    },
  },
});

export type DocumentGenerationControlService = typeof documentGenerationControlService;

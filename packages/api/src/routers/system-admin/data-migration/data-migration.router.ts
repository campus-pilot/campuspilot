import {
  dataMigrationRunTable,
  dataMigrationSkippedItemTable,
} from '@campuspilot/db/schema/data-migration';
import { SYSTEM_ACTIONS } from '@campuspilot/opa/policies/system';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';

import { handOffDataMigrationRun } from '../../../data-migrations/data-migration.outbox';
import { DATA_MIGRATIONS, findDataMigration } from '../../../data-migrations/registry';
import { requestDataMigrationRun } from '../../../data-migrations/run-store';
import { rpcError, toRpcError } from '../../../errors';
import { protectedProcedure } from '../../../index';
import { requireSystemPermission } from '../../../permissions/system';
import {
  dataMigrationRunDtoSchema,
  listDataMigrationSkippedItemsInputSchema,
  listDataMigrationSkippedItemsOutputSchema,
  listDataMigrationsOutputSchema,
  requestDataMigrationRunInputSchema,
  type DataMigrationRunDto,
} from './data-migration.dto';

/** Hidden from MCP: platform operations on every school's data. */
const MCP_META = { exposure: 'hidden', destructive: false, module: 'platform' } as const;

/** Runs shown per migration in the admin view. */
const RECENT_RUNS = 5;

function toRunDto(run: typeof dataMigrationRunTable.$inferSelect): DataMigrationRunDto {
  return dataMigrationRunDtoSchema.parse(run);
}

/**
 * Platform-admin view and control of data migrations (plan Phase 1a). Runs
 * registered on boot appear here like requested ones. Requesting a run only
 * records it and hands it to the worker in the background; the request never
 * waits for the worker.
 */
export const dataMigrationRouter = {
  listDataMigrations: protectedProcedure
    .route({
      summary: 'List data migrations',
      description: 'List every registered data migration with its most recent runs. Requires system-administrator permission.',
      tags: ['System Admin', 'Data migrations'],
    })
    .meta({ mcp: { ...MCP_META, access: 'read' } })
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_DATA_MIGRATIONS))
    .output(listDataMigrationsOutputSchema)
    .handler(async ({ context }) => {
      try {
        const ids = DATA_MIGRATIONS.map((migration) => migration.id);
        const ranked = ids.length === 0
          ? []
          : await context.db
            .select({
              run: dataMigrationRunTable,
              rank: sql<number>`row_number() over (partition by ${dataMigrationRunTable.migrationId} order by ${dataMigrationRunTable.requestedAt} desc, ${dataMigrationRunTable.id} desc)`.mapWith(Number).as('rank'),
            })
            .from(dataMigrationRunTable)
            .where(inArray(dataMigrationRunTable.migrationId, ids));
        const runs = ranked
          .filter((row) => row.rank <= RECENT_RUNS)
          .sort((a, b) => a.rank - b.rank)
          .map((row) => row.run);
        return {
          items: DATA_MIGRATIONS.map((migration) => ({
            id: migration.id,
            description: migration.description,
            runs: runs.filter((run) => run.migrationId === migration.id).map(toRunDto),
          })),
        };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  listDataMigrationSkippedItems: protectedProcedure
    .route({
      summary: 'List the skipped items of a data migration run',
      description: 'Page through the items a data migration run reported instead of migrating. Requires system-administrator permission.',
      tags: ['System Admin', 'Data migrations'],
    })
    .meta({ mcp: { ...MCP_META, access: 'read' } })
    .input(listDataMigrationSkippedItemsInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_DATA_MIGRATIONS))
    .output(listDataMigrationSkippedItemsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const rows = await context.db
          .select({
            itemKey: dataMigrationSkippedItemTable.itemKey,
            reason: dataMigrationSkippedItemTable.reason,
            detail: dataMigrationSkippedItemTable.detail,
          })
          .from(dataMigrationSkippedItemTable)
          .where(and(
            eq(dataMigrationSkippedItemTable.runId, input.runId),
            input.after === undefined ? undefined : gt(dataMigrationSkippedItemTable.itemKey, input.after),
          ))
          .orderBy(asc(dataMigrationSkippedItemTable.itemKey))
          .limit(input.limit + 1);
        const items = rows.slice(0, input.limit);
        return { items, nextAfter: rows.length > input.limit ? items.at(-1)!.itemKey : null };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  requestDataMigrationRun: protectedProcedure
    .route({
      summary: 'Request a data migration run',
      description: 'Request an apply run or a dry run of a registered data migration. It is handed to the worker in the background; at most one run per migration is pending or running at a time. Requires system-administrator permission.',
      tags: ['System Admin', 'Data migrations'],
    })
    .meta({ mcp: { ...MCP_META, access: 'write', destructive: true } })
    .input(requestDataMigrationRunInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.RUN_DATA_MIGRATION))
    .output(dataMigrationRunDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        if (!findDataMigration(input.migrationId)) throw rpcError.notFound('Data migration');
        const run = await requestDataMigrationRun(context.db, {
          migrationId: input.migrationId,
          dryRun: input.dryRun,
          requestedBy: context.session.user.id,
        });
        if (!run) throw rpcError.conflict('This migration already has a pending or running run.');
        handOffDataMigrationRun(run.id);
        return toRunDto(run);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};

import { leadTable } from '@campuspilot/db/schema/lead';
import { SYSTEM_ACTIONS } from '@campuspilot/opa/policies/system';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';

import { toRpcError } from '../../../errors';
import { platformAdminProcedure } from '../../../index';
import { createNextPageCursor, createPaginatedResult, resolvePaginationInput } from '../../../paginations';
import { requireSystemPermission } from '../../../permissions/system';
import { listLeadsInputSchema, listLeadsOutputSchema } from './lead.dto';

/** Hidden from MCP: prospects' contact details, for platform admins only. */
const MCP_META = { exposure: 'hidden', destructive: false, module: 'platform' } as const;

/** Answers the admin search matches, by key of the stored response. */
const SEARCHED_ANSWERS = ['name', 'phone', 'whatsappNumber', 'email', 'schoolName'] as const;

/** Escapes `%`, `_` and `\` so a search term matches literally. */
function likePattern(term: string) {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** Platform-admin view of marketing leads (the admin app's Demo requests page). */
export const leadRouter = {
  listLeads: platformAdminProcedure
    .route({
      summary: 'List leads',
      description: 'List the leads from the website forms, newest first, with their answers and WhatsApp alert status. Requires system-administrator permission.',
      tags: ['System Admin', 'Leads'],
    })
    .meta({ mcp: { ...MCP_META, access: 'read' } })
    .input(listLeadsInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_LEADS))
    .output(listLeadsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const { currentPage, pageSize, offset } = resolvePaginationInput(input);
        const pattern = likePattern(input.searchQuery);
        const search = input.searchQuery
          ? or(...SEARCHED_ANSWERS.map((key) => ilike(sql<string>`${leadTable.response} ->> ${key}`, pattern)))
          : undefined;
        const status = input.filters?.alertStatus ? eq(leadTable.alertStatus, input.filters.alertStatus) : undefined;
        const where = and(search, status);
        const [rows, totalRows] = await Promise.all([
          context.db
            .select({
              id: leadTable.id,
              form: leadTable.form,
              formVersion: leadTable.formVersion,
              response: leadTable.response,
              sourcePath: leadTable.sourcePath,
              userAgent: leadTable.userAgent,
              createdAt: leadTable.createdAt,
              alertStatus: leadTable.alertStatus,
              alertHandedOverAt: leadTable.alertHandedOverAt,
              alertLastHandoverError: leadTable.alertLastHandoverError,
              alertSentAt: leadTable.alertSentAt,
              alertError: leadTable.alertError,
            })
            .from(leadTable)
            .where(where)
            .orderBy(desc(leadTable.createdAt), desc(leadTable.id))
            .limit(pageSize)
            .offset(offset),
          context.db.select({ totalItems: count() }).from(leadTable).where(where),
        ]);
        const totalItems = totalRows[0]?.totalItems ?? 0;
        const totalPages = Math.ceil(totalItems / pageSize);
        return createPaginatedResult({ items: rows, nextCursor: createNextPageCursor(currentPage, totalPages), currentPage, pageSize, totalItems, totalPages });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};

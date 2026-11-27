import { toRpcError } from '../../errors';
import { protectedProcedure } from '../../index';
import { createPersonalSpaceOutputSchema, personalSpaceStatusDtoSchema } from '../../personal-space/personal-space.contract';
import { createPersonalSpace, readPersonalSpaceStatus } from '../../personal-space/personal-space.service';

/**
 * Personal spaces (docs/personal-space.md), mounted as `personalSpace` beside
 * `school` because nothing here is scoped to a school: both act on the
 * signed-in person and decide from that person's own facts. Hidden from MCP
 * and the assistant: opening a personal space is a human decision.
 */
export const personalSpaceRouter = {
  getStatus: protectedProcedure
    .route({
      summary: 'Get my personal space',
      description: "The signed-in person's personal space, if any, and whether they may create one now (refusal null).",
      tags: ['School'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'schools' } })
    .output(personalSpaceStatusDtoSchema)
    .handler(async ({ context }) => {
      try {
        return await readPersonalSpaceStatus(context.db, context.session.user.id);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  create: protectedProcedure
    .route({
      summary: 'Create my personal space',
      description:
        'Create the personal space of the signed-in person: a space of their own for question papers, on the same trial a new school gets. Only for someone with a linked Google account who has never had one, whether or not they belong to a school; refused with data.reason PERSONAL_SPACE_REFUSED otherwise. It does not use the school creation allowance.',
      tags: ['School'],
    })
    .meta({ mcp: { exposure: 'hidden', access: 'write', destructive: false, module: 'schools' } })
    .output(createPersonalSpaceOutputSchema)
    .handler(async ({ context }) => {
      try {
        return await context.db.transaction((transaction) =>
          createPersonalSpace(transaction, { userId: context.session.user.id, now: new Date() }),
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};

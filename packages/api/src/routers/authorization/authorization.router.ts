import { protectedProcedure } from '../../index';
import { checkPermissions } from '../../permissions/authorization';
import {
  checkPermissionsInputSchema,
  checkPermissionsOutputSchema,
} from './authorization.dto';

export const authorizationRouter = {
  checkPermissions: protectedProcedure
    .route({
      summary: 'Check permissions',
      description:
        'Evaluate between one and one hundred ordered authorization requests for the authenticated user.',
      tags: ['Authorization'],
    })
    .input(checkPermissionsInputSchema)
    .output(checkPermissionsOutputSchema)
    .handler(async ({ context, input, signal }) => ({
      results: await checkPermissions(context, input.permissions, signal),
    })),
};

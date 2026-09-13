import type { SystemAction } from '@campuspilot/opa/actions/system';

import { o } from '../index';
import { assertPermission } from './authorization';

/** System actions only receive explicitly configured global-role grants. */
export function requireSystemPermission(action: SystemAction) {
  return o.middleware(async ({ context, next, signal }) => {
    await assertPermission(
      context,
      { action, resource: { level: 'system' } },
      signal,
    );

    return next();
  });
}

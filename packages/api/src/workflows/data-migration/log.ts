import { createLogger } from '@campuspilot/logger';

/** Data migration logger. Only IDs and counts, never row contents. */
export const log = createLogger({ pkg: 'data-migration' });

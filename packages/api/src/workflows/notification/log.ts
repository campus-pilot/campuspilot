import { createLogger } from '@campuspilot/logger';

/** Notification logger. Only IDs, types and counts, never payloads or contact data. */
export const log = createLogger({ pkg: 'notification' });

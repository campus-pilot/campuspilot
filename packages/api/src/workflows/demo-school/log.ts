import { createLogger } from '@campuspilot/logger';

/** Demo workflow logger. Never log passwords or personal data, only IDs and counts. */
export const log = createLogger({ pkg: 'demo-school' });

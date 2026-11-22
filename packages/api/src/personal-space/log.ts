import { createLogger } from '@campuspilot/logger';

/** Personal space logger. Only user and school ids, never names or emails. */
export const log = createLogger({ pkg: 'personal-space' });

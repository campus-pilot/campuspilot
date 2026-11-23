import { createLogger } from '@campuspilot/logger';

/** School setup logger. Never log answers, names or contact details, only ids, steps and outcomes. */
export const log = createLogger({ pkg: 'school-setup' });

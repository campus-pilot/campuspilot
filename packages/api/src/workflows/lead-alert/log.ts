import { createLogger } from '@campuspilot/logger';

/** Lead alert logger. Never log names, phone numbers or answers, only lead ids and outcomes. */
export const log = createLogger({ pkg: 'lead-alert' });

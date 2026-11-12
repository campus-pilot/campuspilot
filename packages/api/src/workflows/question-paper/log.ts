import { createLogger } from '@campuspilot/logger';

/** Question paper logger. Never log question text, page contents or personal data, only ids and counts. */
export const log = createLogger({ pkg: 'question-paper' });

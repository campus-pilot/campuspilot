import { createLogger } from '@campuspilot/logger';

/** Document generation logger. Never log document content, names or other personal data, only ids, counts and sizes. */
export const log = createLogger({ pkg: 'document-generation' });

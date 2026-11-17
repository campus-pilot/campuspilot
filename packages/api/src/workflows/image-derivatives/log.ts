import { createLogger } from '@campuspilot/logger';

/** Image derivative logger. Ids and counts only, never file names or image contents. */
export const log = createLogger({ pkg: 'image-derivatives' });

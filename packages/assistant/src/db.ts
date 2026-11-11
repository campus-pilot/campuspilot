/**
 * The assistant's rows live in the main database (`@campuspilot/db`,
 * `schema/assistant`). Only the assistant's own code reads and writes them;
 * the model never does (see runtime/tools.ts).
 */
export { db } from '@campuspilot/db';
export type { Database as AssistantDatabase, DatabaseExecutor as AssistantExecutor } from '@campuspilot/db';

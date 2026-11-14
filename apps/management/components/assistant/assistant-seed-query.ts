import { parseQuestionPaperSeedParams, type QuestionPaperSeed } from '@campuspilot/assistant-contract/attachments';

/**
 * The question paper a new conversation starts from, read from the
 * address's query (see `AssistantWorkspaceFromAddress`). Every value of a
 * repeated parameter is passed on, as a server page receives them, so the
 * parser's rule (the first one counts) holds; `Object.fromEntries` would
 * keep only the last.
 */
export function seedFromQuery(query: URLSearchParams): QuestionPaperSeed | null {
  return parseQuestionPaperSeedParams(Object.fromEntries([...new Set(query.keys())].map((key) => [key, query.getAll(key)])));
}

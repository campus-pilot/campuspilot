/**
 * Developer-facing description of an error for `error_detail` and the logs.
 *
 * Provider SDK errors wrap the API's JSON body in their message (Gemini:
 * `{"error":{"message":"{\n \"error\": {...}}","code":400,"status":"Bad Request"}}`,
 * Anthropic: `400 {"type":"error","error":{...},"request_id":"req_..."}`), so
 * the useful sentence is unwrapped from the JSON, the HTTP status and the
 * provider's status text are kept, and the request id is kept for support.
 * Request content never appears here, and an error from the database client
 * has its bound `params:` (row values) cut off.
 */

const MAX_DETAIL_CHARS = 800;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start === -1) return undefined;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return undefined;
  }
}

/** Collects the human sentences, provider status words and request id out of nested JSON error bodies. */
function collect(body: unknown, into: { messages: string[]; words: string[]; requestId?: string }, depth = 0): void {
  if (!isObject(body) || depth > 4) return;
  if (typeof body.request_id === 'string') into.requestId ??= body.request_id;
  if (typeof body.status === 'string' && body.status !== 'Bad Request') into.words.push(body.status);
  if (typeof body.type === 'string' && body.type !== 'error') into.words.push(body.type);
  if (typeof body.message === 'string') {
    const nested = parseJson(body.message);
    if (nested === undefined) into.messages.push(body.message.trim());
    else collect(nested, into, depth + 1);
  }
  if (isObject(body.error)) collect(body.error, into, depth + 1);
}

export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error).slice(0, MAX_DETAIL_CHARS);
  const status = (error as { status?: unknown }).status;
  const found: { messages: string[]; words: string[]; requestId?: string } = { messages: [], words: [] };
  collect(parseJson(error.message), found);
  const words = [...new Set(found.words)];
  const sentence = found.messages.length > 0 ? [...new Set(found.messages)].join(' ') : error.message.split('\nparams:')[0]!;
  const parts = [
    error.name,
    typeof status === 'number' ? `HTTP ${status}` : undefined,
    words.length > 0 ? words.join(' ') : undefined,
  ].filter((part): part is string => part !== undefined);
  const request = found.requestId ? ` (request ${found.requestId})` : '';
  return `${parts.join(' ')}: ${sentence}${request}`.slice(0, MAX_DETAIL_CHARS);
}

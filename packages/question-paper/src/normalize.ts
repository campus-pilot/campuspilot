import { sha256Hex } from "./sha256";
import { questionPaper, type QuestionPaper } from "./schema";
import { formatPath } from "./walk";

export type QuestionPaperIssue = { path: string; message: string };

export type NormalizeResult =
  | { ok: true; value: QuestionPaper }
  | { ok: false; errors: QuestionPaperIssue[] };

/** Applies Unicode NFC to every string. NFC is idempotent, so normalizing twice changes nothing. */
function nfc(value: unknown): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map(nfc);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, nfc(item)]),
    );
  }
  return value;
}

/**
 * Parses untrusted JSON (a model's output, an agent's tool input) into the
 * stored form: Unicode NFC text and schema defaults applied. This is the only
 * way a document enters the system, so a stored paper and the draft id of the
 * same input always agree.
 *
 * Figure id rewriting (`asat_` to `qpf_`) is not done here: it needs the
 * database, so the API does it after this step.
 */
export function normalizeQuestionPaper(input: unknown): NormalizeResult {
  const parsed = questionPaper.safeParse(nfc(input));
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => ({
      path: formatPath(issue.path.filter((p): p is string | number => typeof p !== "symbol")),
      message: issue.message,
    })),
  };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

/** JSON with sorted keys and no whitespace: the same document always serializes identically. */
export function canonicalQuestionPaperJson(paper: QuestionPaper): string {
  return JSON.stringify(sortKeys(paper));
}

/** Full SHA-256 of the canonical JSON; stored as `content_sha256`. */
export function questionPaperContentSha256(paper: QuestionPaper): string {
  return sha256Hex(canonicalQuestionPaperJson(paper));
}

/**
 * The identifier of a draft: the first 12 hex characters of the content hash.
 * A draft is not a database row; this id lets a chat agent save "the draft
 * you just validated" without re-sending thousands of tokens.
 */
export function questionPaperDraftId(paper: QuestionPaper): string {
  return questionPaperContentSha256(paper).slice(0, 12);
}

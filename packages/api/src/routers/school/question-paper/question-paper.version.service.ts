import type { Database, DatabaseExecutor } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import { assistantItemTable } from '@campuspilot/db/schema/assistant';
import { generateId } from '@campuspilot/db/id';
import { measure } from '@campuspilot/logger/perf';
import {
  examQuestionPaperFigureTable,
  examQuestionPaperJobTable,
  examQuestionPaperTable,
  examQuestionPaperVersionTable,
  type QuestionPaperPrintedDetails,
} from '@campuspilot/db/schema/exam-question-paper';
import { encodedImageBytes } from '@campuspilot/assistant-contract/attachments';
import {
  canonicalQuestionPaperHtml,
  questionPaperContentSha256,
  questionPaperDraftId,
  type QuestionPaperNotice,
} from '@campuspilot/question-paper/hash';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { rpcError } from '../../../errors';
import { FIGURE_MAX_BYTES } from '../../../files/image-derivative';
import { convertDocumentPdf } from '../document/document.render';
import { assertPersonalSpaceStorageRoom, assertStandaloneVersionRoom } from '../../../personal-space/personal-space.storage';
import { documentDownloadUrl, persistDocumentObject } from '../document/document.storage';
import { attachmentFigureIds, attachmentFigureProblems, chatFiguresOf, convertAttachmentFigures, isAttachmentFigureId, type ChatFigures } from './question-paper.attachments';
import { buildPaperContext } from './question-paper.print-context';
import { conversationRefOf, isPaperChat, type PaperConversationRef } from './question-paper.conversations';
import { createMathRenderer, renderMathSpans } from './question-paper.math';
import {
  findPaper,
  findPaperOf,
  lockOrCreatePaperOf,
  templateMissingError,
  type PaperRow,
  type VersionRow,
} from './question-paper.records';
import { estimatedBodyBytes, figureIdsToPlaceholders, fragmentFigureIds } from './question-paper.body';
import { assertCopySourceAllowed, copySourceFigures, copySourceNotFoundError, storedFigureIds } from './question-paper.copy';
import type { PaperKey } from './question-paper.dto';
import {
  loadFigureAssets,
  QUESTION_PAPER_BODY_MAX_BYTES,
  QUESTION_PAPER_FIGURES_MAX_BYTES,
  readPinnedQuestionPaperTemplate,
  renderQuestionPaperBody,
  renderQuestionPaperDocument,
  renderQuestionPaperTemplate,
  renderStandaloneQuestionPaperDocument,
  renderStandaloneQuestionPaperShell,
  selectedQuestionPaperTemplate,
} from './question-paper.render';
import { convertQuestionPaperDocx, DOCX_CONTENT_TYPE, sharedDocxConversion } from './question-paper.docx-convert';
import { questionPaperDocxHtml } from './question-paper.docx-html';
import { sanitizeQuestionPaperBody, type SanitizedQuestionPaperBody } from './question-paper.sanitize';
import {
  assertResolvedPaperWritable,
  assertResolvedPaperWritableLocked,
  isStandalonePaper,
  paperSchoolIdOf,
  printLayoutOf,
  type PaperScope,
  type ResolvedPaper,
} from './question-paper.scope';
import type { QuestionPaperDetails } from '@campuspilot/question-paper/details';

/** The most validation errors one refusal message lists. */
const MAX_LISTED_ERRORS = 10;
/** How often a job's save is re-rendered when another version lands between its render and its commit. */
const MAX_JOB_SAVE_ATTEMPTS = 3;

/**
 * The checked form of a fragment an agent or the AI job wrote. `ok: false`
 * lists every problem so a model can fix them in one round; `stripped` (what
 * the sanitiser removed or changed) is reported either way.
 */
export type DraftCheck =
  | {
      ok: true;
      /** The cleaned fragment: what is stored, and what rendering cleans again. */
      html: string;
      /** `stripped` as stored with the version. */
      notices: QuestionPaperNotice[];
      stripped: string[];
      /** The id of the fragment as it was written (before cleaning). */
      draftId: string;
      placeholderFigures: number;
      characters: number;
    }
  | { ok: false; problems: string[]; stripped: string[] };

/** How the check treats a figure id that cannot be used. */
export type UnresolvedFigures =
  /** A problem the writer must fix (an agent in chat, which can attach or drop the figure). */
  | 'problem'
  /** The figure becomes a placeholder and the user is told (the AI job, which has no way to attach images). */
  | 'placeholder';

/**
 * Why each figure id cannot be used, by id; a missing key means it can. An id
 * must name a stored figure of this paper, or a chat attachment `chat` may
 * use (`asat_` id; see `question-paper.attachments.ts`): an
 * attachment is checked here and copied into a figure only when a version is
 * saved.
 */
async function figureProblems(
  db: DatabaseExecutor,
  input: { schoolId: string; paper: PaperRow | undefined; chat: ChatFigures | undefined },
  ids: readonly string[],
): Promise<Map<string, string>> {
  const problems = new Map<string, string>();
  if (ids.length === 0) return problems;
  const stored = new Set(
    input.paper
      ? (
          await db
            .select({ id: examQuestionPaperFigureTable.id })
            .from(examQuestionPaperFigureTable)
            .where(and(eq(examQuestionPaperFigureTable.paperId, input.paper.id), eq(examQuestionPaperFigureTable.schoolId, input.paper.schoolId)))
        ).map((row) => row.id)
      : [],
  );
  const attachmentProblems = await attachmentFigureProblems(db, {
    schoolId: input.schoolId,
    chat: input.chat,
    ids: ids.filter(isAttachmentFigureId),
  });
  for (const id of ids) {
    if (isAttachmentFigureId(id)) {
      const problem = attachmentProblems.get(id);
      if (problem) problems.set(id, problem);
    } else if (!stored.has(id)) {
      problems.set(id, 'This figure image does not belong to this paper. Use the asat_ id of an attachment of this chat, a qpf_ id from getQuestionPaper, or <figure data-placeholder="..."></figure>.');
    }
  }
  return problems;
}

/**
 * The base64 data URI bytes the printer embeds for each of these figures (`loadFigureAssets`), so a draft that validates
 * can also be printed. A chat image becomes a figure of at most about FIGURE_MAX_BYTES.
 */
async function embeddedFigureSizes(db: DatabaseExecutor, paper: PaperRow | undefined, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = paper
    ? await db
        .select({ id: examQuestionPaperFigureTable.id, contentType: examQuestionPaperFigureTable.contentType, byteSize: examQuestionPaperFigureTable.byteSize })
        .from(examQuestionPaperFigureTable)
        .where(and(eq(examQuestionPaperFigureTable.paperId, paper.id), eq(examQuestionPaperFigureTable.schoolId, paper.schoolId)))
    : [];
  const sizeOf = new Map(rows.map((row) => [row.id, `data:${row.contentType};base64,`.length + encodedImageBytes(row.byteSize)]));
  return new Map(ids.map((id) => [id, sizeOf.get(id) ?? encodedImageBytes(FIGURE_MAX_BYTES)]));
}

/** Whether a cleaned fragment prints anything: text, a drawing, a formula or a figure. */
function hasContent({ html, stats }: SanitizedQuestionPaperBody): boolean {
  if (stats.mathNodes > 0 || stats.figureIds.length > 0 || stats.placeholders > 0 || stats.svgs > 0) return true;
  return html.replace(/<style>[^<]*<\/style>/g, '').replace(/<[^<>]*>/g, '').trim() !== '';
}

const noticesOf = (stripped: readonly string[]): QuestionPaperNotice[] => stripped.map((message) => ({ code: 'sanitised', message }));

/**
 * Validates untrusted HTML as a question paper of this plan, persisting
 * nothing: the sanitiser (and the caps it enforces), that the paper prints
 * something, every formula with KaTeX, every figure id and the printed size.
 * The same function guards `validateQuestionPaperDraft`, the save and the AI
 * job, so a draft that validated saves and a save cannot be weaker than a
 * validation.
 *
 * What the sanitiser removes is NOT a problem: it is reported as `stripped`
 * and the paper saves without it (an AI job's output must not fail because it
 * wrote a style we do not accept). Only caps, an empty paper, a formula KaTeX
 * rejects and unusable figures block.
 */
export async function checkQuestionPaperDraft(
  db: DatabaseExecutor,
  scope: ResolvedPaper,
  raw: string,
  options: DraftCheckOptions = {},
): Promise<DraftCheck> {
  return measure('qp.draft.check', () => checkQuestionPaperDraftUntimed(db, scope, raw, options));
}

type DraftCheckOptions = {
  /** The chat attachments the fragment may use as figures (`chatFiguresOf`); omitted outside the in-app assistant and the app. */
  chat?: ChatFigures;
  unresolvedFigures?: UnresolvedFigures;
  /**
   * For a caller with nobody to look at what the sanitiser changed (the AI job): a pseudo-tag such as `<thinking>`
   * or text between the top-level elements is a problem (to be repaired) instead of a notice, because its text would
   * otherwise be printed as part of the paper. A person's draft keeps them as notices.
   */
  strictStructure?: boolean;
};

/** {@link checkQuestionPaperDraft} without its `qp.draft.check` timing. */
async function checkQuestionPaperDraftUntimed(
  db: DatabaseExecutor,
  scope: ResolvedPaper,
  raw: string,
  options: DraftCheckOptions,
): Promise<DraftCheck> {
  const canonical = canonicalQuestionPaperHtml(raw);
  let sanitized = sanitizeQuestionPaperBody(canonical);
  const stripped = [...sanitized.stripped];
  if (sanitized.problems.length > 0) return { ok: false, problems: sanitized.problems, stripped };

  const problems: string[] = [];
  if (options.strictStructure) {
    const { foreignTags, looseText } = sanitized.structure;
    if (foreignTags.length > 0) {
      const listed = foreignTags.slice(0, 5).map((tag) => `<${tag}>`).join(', ');
      problems.push(`${listed} ${foreignTags.length === 1 ? 'is' : 'are'} not HTML elements, so ${foreignTags.length === 1 ? 'its' : 'their'} text would be printed as part of the paper. Return only the paper's HTML, with no reasoning or answer wrappers.`);
    }
    if (looseText) problems.push('There is text outside every element (for example a sentence between two paragraphs). Put all text inside elements such as <p>.');
  }
  if (!hasContent(sanitized)) problems.push('The paper is empty. Write the questions as HTML.');

  const paper = await findPaperOf(db, scope);
  const unusable = await figureProblems(db, { schoolId: paperSchoolIdOf(scope), paper, chat: options.chat }, sanitized.stats.figureIds);
  if (unusable.size > 0) {
    if (options.unresolvedFigures === 'placeholder') {
      sanitized = sanitizeQuestionPaperBody(figureIdsToPlaceholders(sanitized.html, new Set(unusable.keys())));
      stripped.push(`${unusable.size} figure ${unusable.size === 1 ? 'image' : 'images'} could not be attached and became ${unusable.size === 1 ? 'a placeholder' : 'placeholders'}`);
    } else {
      for (const [id, problem] of unusable) problems.push(`Figure ${id}: ${problem}`);
    }
  }

  // The figures are embedded as one total under their own cap, and then figures + formulas + the stylesheet are held to
  // the SAME body budget the print measures (`estimatedBodyBytes`), so what validates also prints.
  // A figure used twice is embedded twice in the body but loaded once, so the two totals differ.
  let figureBytes = 0;
  let placedFigures = 0;
  let distinctFigureBytes = 0;
  if (unusable.size === 0 || options.unresolvedFigures === 'placeholder') {
    const sizes = await embeddedFigureSizes(db, paper, sanitized.stats.figureIds);
    distinctFigureBytes = [...sizes.values()].reduce((sum, size) => sum + size, 0);
    for (const use of sanitized.html.matchAll(/ data-figure-id="([^"]*)"/g)) {
      figureBytes += sizes.get(use[1]!) ?? 0;
      placedFigures += 1;
    }
    if (distinctFigureBytes > QUESTION_PAPER_FIGURES_MAX_BYTES) problems.push('The figure images of this paper are too large to print together. Use fewer or smaller images.');
  }

  const math = createMathRenderer();
  const typeset = renderMathSpans(sanitized.html, math);
  for (const failure of typeset.failures) {
    problems.push(`Formula ${failure.index} (${failure.tex.slice(0, 60)}): ${failure.message}`);
  }
  // KaTeX HTML is large (tens of KB for one nested formula, 85 KB for a wide matrix): count it with the figures.
  if (
    typeset.failures.length === 0 &&
    distinctFigureBytes <= QUESTION_PAPER_FIGURES_MAX_BYTES &&
    estimatedBodyBytes({ typesetHtml: typeset.html, hasMath: typeset.count > 0, figureBytes, figureCount: placedFigures }) > QUESTION_PAPER_BODY_MAX_BYTES
  ) {
    problems.push(
      figureBytes === 0
        ? 'The formulas of this paper are too large to print. Shorten or remove some formulas.'
        : 'The formulas and figure images of this paper are too large to print together. Remove some figures or shorten some formulas.',
    );
  }

  if (problems.length > 0) return { ok: false, problems, stripped };
  return {
    ok: true,
    html: sanitized.html,
    notices: noticesOf(stripped),
    stripped,
    draftId: questionPaperDraftId(canonical),
    placeholderFigures: sanitized.stats.placeholders,
    characters: sanitized.html.length,
  };
}

/** The refusal for a fragment that failed {@link checkQuestionPaperDraft}: BAD_REQUEST listing the first problems. */
export function invalidPaperError(problems: readonly string[]) {
  const listed = problems.slice(0, MAX_LISTED_ERRORS);
  const more = problems.length > MAX_LISTED_ERRORS ? ` (and ${problems.length - MAX_LISTED_ERRORS} more)` : '';
  return rpcError.badRequest(`The question paper is not valid${more}. ${listed.join('; ')}`);
}

/**
 * The validate tool whose calls hold a paper's drafts, by the paper's kind: a
 * standalone paper's drafts are validated with `validateStandalonePaperDraft`
 * (its own rules: the heading is part of the paper), an exam paper's with
 * `validateQuestionPaperDraft`. A draft of one kind is never saved as the other.
 */
const DRAFT_TOOL_NAME = {
  exam: /(^|[._])validateQuestionPaperDraft$/,
  standalone: /(^|[._])validateStandalonePaperDraft$/,
} as const satisfies Record<PaperConversationRef['kind'], RegExp>;
/** How many of a conversation's newest tool calls are searched for a draft. */
const DRAFT_SEARCH_DEPTH = 60;

/**
 * Finds the HTML a chat agent validated earlier in this conversation
 * (design E7): the newest call of the paper kind's validate tool
 * ({@link DRAFT_TOOL_NAME}) whose input
 * `html` hashes to `draftId`. A draft is not a database row; the chat transcript is
 * its only home, which is why this reads the assistant's items, scoped to the
 * conversation, its school and its user. External clients have no
 * conversation and pass `html` instead.
 */
export async function findChatDraftContent(
  db: DatabaseExecutor,
  input: { conversationId: string; paper: PaperConversationRef; userId: string; draftId: string },
): Promise<string> {
  const notFound = rpcError.badRequest('No draft with that draftId was validated in this conversation. Send the full html instead.');
  // The user's own chat, or one shared with this paper (continued by a colleague): drafts are read from nothing else.
  if (!(await isPaperChat(db, { conversationId: input.conversationId, userId: input.userId, paper: input.paper }))) throw notFound;
  const items = await db
    .select({ body: assistantItemTable.body })
    .from(assistantItemTable)
    .where(and(eq(assistantItemTable.conversationId, input.conversationId), eq(assistantItemTable.kind, 'tool_call')))
    .orderBy(desc(assistantItemTable.position))
    .limit(DRAFT_SEARCH_DEPTH);
  for (const { body } of items) {
    const call = body as { toolName?: unknown; input?: unknown };
    if (typeof call.toolName !== 'string' || !DRAFT_TOOL_NAME[input.paper.kind].test(call.toolName)) continue;
    const html = (call.input as { html?: unknown } | null)?.html;
    if (typeof html === 'string' && questionPaperDraftId(html) === input.draftId) return html;
  }
  throw notFound;
}

/**
 * `getQuestionPaperDraft`: the cleaned fragment of a draft this chat validated
 * (found by {@link findChatDraftContent}, so scoped to the conversation, school
 * and user). Cleaned rather than as written so it never exceeds the fragment
 * limit and is what a save would store; the draft id (hash of the text as written)
 * is returned unchanged for the save. A draft whose cleaning now reports problems
 * (limits changed since it was validated) is refused with them.
 */
export function cleanedChatDraft(raw: string): { draftId: string; html: string } {
  const sanitized = sanitizeQuestionPaperBody(canonicalQuestionPaperHtml(raw));
  if (sanitized.problems.length > 0) throw invalidPaperError(sanitized.problems);
  return { draftId: questionPaperDraftId(raw), html: sanitized.html };
}

export type SaveSource =
  | { kind: 'agent'; conversationId: string | null }
  | { kind: 'ai_job'; jobId: string; pageIds: string[] }
  /** A version of another paper (same school, class and subject) copied by a person; see `question-paper.copy.ts`. */
  | { kind: 'copy'; sourcePaperId: string; sourceVersionId: string };

export type SavedVersion = {
  versionNo: number;
  paperId: string;
  /** The exam plan's maximum marks the version snapshotted; always null for a standalone paper, which has no plan. */
  planMaxMarks: number | null;
  warnings: QuestionPaperNotice[];
  hasPdf: true;
  /** True when this job had already saved its version and nothing was written. */
  replayed: boolean;
};

/** Another version landed between a job's render and its commit: render again with the new number. */
class VersionRaceError extends Error {}

/** The generation job that is saving this version ended (swept at its deadline, deleted) before the save committed. */
export class SourceJobEndedError extends Error {}

/** The details a standalone paper's names are made of, as its row holds them now. */
type NamedDetails = Pick<QuestionPaperDetails, 'subjectName' | 'className' | 'examName'>;

/** What a paper's PDF is named after: the exam plan's names, or a standalone paper's current details. */
type PaperNames = { kind: 'exam'; scope: PaperScope } | { kind: 'standalone'; details: NamedDetails };

const artifactName = (names: PaperNames, versionNo: number) => {
  if (names.kind === 'exam') return `Question paper: ${names.scope.subjectName} (${names.scope.modeName}) - ${names.scope.className} - v${versionNo}`;
  const parts = [names.details.subjectName, names.details.className, names.details.examName].filter((part): part is string => part !== null);
  return `Question paper: ${parts.length > 0 ? parts.join(' - ') : 'Untitled'} - v${versionNo}`;
};

/**
 * The name a downloaded version's PDF is saved under, without `.pdf`:
 * subject, class, mode and version joined by underscores
 * (`Hindi_Class 1_Written_v2`). Kept apart from the artifact's name, which
 * Documents history shows, and derived from the paper at download time, so
 * PDFs stored before this format download under it too.
 */
const downloadFileName = (names: PaperNames, versionNo: number) => {
  if (names.kind === 'exam') return `${names.scope.subjectName}_${names.scope.className}_${names.scope.modeName}_v${versionNo}`;
  // A standalone paper's details are a model's text: only characters a file name can carry are kept.
  const parts = [names.details.subjectName, names.details.className, names.details.examName]
    .filter((part): part is string => part !== null)
    .map((part) => part.replace(/[\\/:*?"<>|]+/g, ' ').trim())
    .filter((part) => part !== '');
  return `${parts.length > 0 ? parts.join('_') : 'Question paper'}_v${versionNo}`;
};

/** The names of a resolved paper, reading a standalone paper's current details from its row. */
async function paperNamesOf(db: DatabaseExecutor, scope: ResolvedPaper): Promise<PaperNames> {
  if (!isStandalonePaper(scope)) return { kind: 'exam', scope };
  const paper = await findPaperOf(db, scope);
  return {
    kind: 'standalone',
    details: { subjectName: paper?.detailsSubjectName ?? null, className: paper?.detailsClassName ?? null, examName: paper?.detailsExamName ?? null },
  };
}

/**
 * The template a version prints with: a school template revision for a paper
 * that prints with its school's template (an exam paper, a quick paper), the
 * built-in shell (no revision) for a `plain` one (`printLayoutOf`).
 */
type PrintTemplate = { kind: 'template'; revisionId: string; name: string; content: string } | { kind: 'plain' };

/**
 * The names a saved version's files carry: the details its heading printed
 * for a quick paper's version (`printed_details`), so an old version is named
 * as it prints; otherwise the paper's names ({@link paperNamesOf}).
 */
async function versionNamesOf(db: DatabaseExecutor, scope: ResolvedPaper, version: VersionRow): Promise<PaperNames> {
  if (version.printedDetails) return { kind: 'standalone', details: version.printedDetails };
  return paperNamesOf(db, scope);
}

/**
 * The heading details a new version of a quick paper prints and keeps
 * (`printed_details`): the ones the save states, else the paper's as stored.
 * Null for any other paper: an exam paper prints its plan's names, a plain
 * paper carries its heading in its body.
 */
function printedDetailsOf(scope: ResolvedPaper, stated: QuestionPaperDetails | undefined, paper: PaperRow | undefined): QuestionPaperPrintedDetails | null {
  if (!isStandalonePaper(scope) || printLayoutOf(scope) !== 'school_template') return null;
  if (stated) return { className: stated.className, subjectName: stated.subjectName, examName: stated.examName, maxMarks: stated.maxMarks };
  return {
    className: paper?.detailsClassName ?? null,
    subjectName: paper?.detailsSubjectName ?? null,
    examName: paper?.detailsExamName ?? null,
    maxMarks: paper?.detailsMaxMarks ?? null,
  };
}

/** The planned maximum marks a new version of this paper snapshots: the exam plan's, none for a standalone paper. */
const planMaxMarksOf = (scope: ResolvedPaper): number | null => (isStandalonePaper(scope) ? null : scope.planMaxMarks);

async function savedByJob(db: DatabaseExecutor, jobId: string): Promise<VersionRow | undefined> {
  const [version] = await db
    .select()
    .from(examQuestionPaperVersionTable)
    .where(eq(examQuestionPaperVersionTable.sourceJobId, jobId))
    .limit(1);
  return version;
}

const savedResult = (version: VersionRow, planMaxMarks: number | null): SavedVersion => ({
  versionNo: version.versionNo,
  paperId: version.paperId,
  planMaxMarks: version.planMaxMarks ?? planMaxMarks,
  warnings: version.warnings,
  hasPdf: true,
  replayed: true,
});

/**
 * Saves a new immutable version of a paper: the one function behind the agent
 * tool, the AI job and a copy of an earlier paper's version, so all of them
 * validate, render, print and number exactly the same way.
 *
 * - The document is checked ({@link checkQuestionPaperDraft}); errors refuse.
 *   Images it prints that the paper does not own yet are copied into the paper
 *   first: chat attachments of an agent save, the source paper's figures of a
 *   copy ({@link checkCopiedFragment}).
 * - Optimistic concurrency: with `expectedVersionNo`, a different current
 *   `latest_version_no` is CONFLICT. A job passes null (it saves whatever is
 *   next) and re-renders if another version lands between its render and its
 *   commit, because the printed version number must match the stored one.
 * - The PDF is rendered with the school's currently selected template, whose
 *   revision is pinned on the version (the template, not the school's later
 *   choice, decides how the version previews and downloads forever).
 * - PDF bytes are uploaded first, then the artifact, the version and the
 *   paper's counter are written in one transaction; a refusal inside it
 *   deletes the upload.
 * - A job's save is idempotent: its version is unique per job id, so a
 *   replayed step returns the version already saved.
 */
export async function saveQuestionPaperVersion(
  db: Database,
  input: {
    scope: ResolvedPaper;
    userId: string;
    expectedVersionNo: number | null;
    /** The fragment as written; it is cleaned and checked here. */
    html: string;
    source: SaveSource;
    /**
     * What the save does to a standalone paper's details
     * (docs/personal-space.md), required for one: the details the saved
     * paper states, which replace all four `details_*` columns in this save's
     * transaction, or `keep` for a version that states none (the generation
     * job's answer without a readable details block), which leaves them as
     * they are. Ignored for an exam paper, whose names come from its plan.
     */
    details?: QuestionPaperDetails | 'keep';
    signal?: AbortSignal;
  },
): Promise<SavedVersion> {
  const { scope, source } = input;
  if (isStandalonePaper(scope) && !input.details) throw new Error('A standalone question paper is saved with its details.');
  if (source.kind === 'ai_job') {
    const done = await savedByJob(db, source.jobId);
    if (done) return savedResult(done, planMaxMarksOf(scope));
  }
  assertResolvedPaperWritable(scope);
  // A standalone paper's limits (docs/personal-space.md "Limits"), looked at before any chat image is copied into the
  // paper and before the PDF is printed, so a refused save writes and prints nothing; the save's transaction checks
  // them again under the lock.
  if (isStandalonePaper(scope)) await assertStandaloneSaveRoom(db, scope, source, false);
  let checked: Extract<DraftCheck, { ok: true }>;
  if (source.kind === 'copy') {
    // Copying an earlier paper is a feature of exam papers (same class and subject); a standalone paper has no class.
    if (isStandalonePaper(scope)) throw new Error('A standalone question paper cannot be started from a copy.');
    checked = await checkCopiedFragment(db, { scope, userId: input.userId, html: input.html, expectedVersionNo: input.expectedVersionNo, sourcePaperId: source.sourcePaperId });
  } else {
    // Chat attachments may be figures only when an agent saves from a chat. The AI job has no way to attach an
    // image, so a figure id it cannot resolve becomes a placeholder; an agent is told and fixes it.
    const chat =
      source.kind === 'agent' && source.conversationId
        ? await chatFiguresOf(db, { userId: input.userId, conversationId: source.conversationId, paper: conversationRefOf(scope) })
        : undefined;
    const unresolvedFigures: UnresolvedFigures = source.kind === 'ai_job' ? 'placeholder' : 'problem';
    const first = await checkQuestionPaperDraft(db, scope, input.html, { chat, unresolvedFigures });
    if (!first.ok) throw invalidPaperError(first.problems);
    checked = first;
    if (attachmentFigureIds(checked.html).length > 0) {
      // Refuse a stale expectedVersionNo before anything is copied: a refused save must not leave figure rows behind.
      await assertExpectedVersion(db, scope, input.expectedVersionNo);
      // Copy the attachments into the paper and store the version with its own figure ids; the fragment is
      // checked again as it will be stored. The notices of the first check are the ones the user is told about.
      const { notices, stripped } = checked;
      const converted = await checkQuestionPaperDraft(db, scope, await convertAttachmentFigures(db, { scope, userId: input.userId, chat: chat!, html: checked.html }));
      if (!converted.ok) throw invalidPaperError(converted.problems);
      checked = { ...converted, notices, stripped };
    }
  }
  const template = await printTemplateFor(db, scope);

  for (let attempt = 1; ; attempt += 1) {
    const paper = await findPaperOf(db, scope);
    const latest = paper?.latestVersionNo ?? 0;
    if (input.expectedVersionNo !== null && input.expectedVersionNo !== latest) {
      throw rpcError.conflict(`The paper changed: its latest version is ${latest}, not ${input.expectedVersionNo}. Read it again with getQuestionPaper.`);
    }
    const versionNo = latest + 1;
    try {
      return await renderAndStore(db, { ...input, versionNo, assumedLatest: latest, checked, template });
    } catch (error) {
      if (error instanceof VersionRaceError && attempt < MAX_JOB_SAVE_ATTEMPTS) continue;
      if (error instanceof VersionRaceError) throw rpcError.conflict('Another version was saved at the same time. Try again.');
      if (source.kind === 'ai_job') {
        // A replayed step that lost a race with itself: the version exists.
        const done = await savedByJob(db, source.jobId);
        if (done) return savedResult(done, planMaxMarksOf(scope));
      }
      throw error;
    }
  }
}

/**
 * A standalone paper's limits for one more version: the version cap and,
 * for every save but the AI job's, the space's save rate
 * (`assertStandaloneVersionRoom`), then the space's stored bytes with the
 * new PDF (`pdfBytes`; 0 for the early look before it is printed). An exam
 * paper has none of these.
 */
async function assertStandaloneSaveRoom(db: DatabaseExecutor, scope: ResolvedPaper, source: SaveSource, lock: boolean, pdfBytes = 0, paperId?: string) {
  const schoolId = paperSchoolIdOf(scope);
  const resolvedPaperId = paperId ?? (await findPaperOf(db, scope))?.id ?? null;
  await assertStandaloneVersionRoom(db, { schoolId, paperId: resolvedPaperId, countsTowardRate: source.kind !== 'ai_job', lock });
  await assertPersonalSpaceStorageRoom(db, { schoolId, addedBytes: pdfBytes, lock });
}

/**
 * The template a new version of this paper prints with: the school's
 * currently selected question paper template for a paper that prints with
 * it (none selected is PRECONDITION_FAILED), the built-in shell for a
 * `plain` one.
 */
async function printTemplateFor(db: DatabaseExecutor, scope: ResolvedPaper): Promise<PrintTemplate> {
  if (printLayoutOf(scope) === 'plain') return { kind: 'plain' };
  const template = await selectedQuestionPaperTemplate(db, paperSchoolIdOf(scope));
  if (!template) throw templateMissingError();
  return { kind: 'template', ...template };
}

/** CONFLICT unless the paper's `latest_version_no` is `expected` (no expectation: the AI job). An early look, not under the lock. */
async function assertExpectedVersion(db: DatabaseExecutor, scope: ResolvedPaper, expected: number | null): Promise<void> {
  if (expected === null) return;
  const latest = (await findPaperOf(db, scope))?.latestVersionNo ?? 0;
  if (expected !== latest) {
    throw rpcError.conflict(`The paper changed: its latest version is ${latest}, not ${expected}. Read it again with getQuestionPaper.`);
  }
}

/**
 * The draft check of a copied version's fragment, for {@link saveQuestionPaperVersion}. The stored fragment is
 * cleaned and checked again (the profile may have become stricter since it was saved), first with its figures
 * standing in as placeholders, so a fragment that would be refused anyway (a formula KaTeX now rejects, a cap)
 * fails before a stale `expectedVersionNo` is looked at and before any figure is copied. Then the source's figures
 * are copied into the target (`copySourceFigures`, which refuses one it cannot copy) and the fragment with the
 * target's figure ids is checked exactly as an agent's save is: every id must be a figure of the target, and
 * figures and formulas must fit the print budget together. The notices are what this cleaning removed.
 */
async function checkCopiedFragment(
  db: Database,
  input: { scope: PaperScope; userId: string; html: string; expectedVersionNo: number | null; sourcePaperId: string },
): Promise<Extract<DraftCheck, { ok: true }>> {
  const { scope } = input;
  const cleaned = sanitizeQuestionPaperBody(canonicalQuestionPaperHtml(input.html));
  if (cleaned.problems.length > 0) throw invalidPaperError(cleaned.problems);
  const figureIds = storedFigureIds(cleaned.html);
  const precheck = await checkQuestionPaperDraft(db, scope, figureIdsToPlaceholders(cleaned.html, new Set(figureIds)), { unresolvedFigures: 'problem' });
  if (!precheck.ok) throw invalidPaperError(precheck.problems);
  await assertExpectedVersion(db, scope, input.expectedVersionNo);
  const html = await copySourceFigures(db, { scope, userId: input.userId, html: cleaned.html, sourcePaperId: input.sourcePaperId });
  const checked = await checkQuestionPaperDraft(db, scope, html, { unresolvedFigures: 'problem' });
  if (!checked.ok) throw invalidPaperError(checked.problems);
  return { ...checked, notices: noticesOf(cleaned.stripped), stripped: cleaned.stripped };
}

/**
 * Starts the target paper from a saved version of an earlier paper: a NEW
 * version of the target whose fragment is the source version's stored fragment
 * (`copyQuestionPaperVersion`). The source is only read and never changes.
 *
 * - The keys must name the same school, class and subject, and not the target
 *   itself ({@link assertCopySourceAllowed}); the source paper and version must
 *   exist in that school (NOT_FOUND `copy_source_not_found`).
 * - Everything else is {@link saveQuestionPaperVersion} with source `copy`:
 *   the target must be writable, `expectedVersionNo` is the target's token
 *   (CONFLICT as for an agent save), the fragment is cleaned and checked again,
 *   the source's figures are copied into the target, the school's currently
 *   selected template prints the PDF, and `plan_max_marks` is the TARGET plan's
 *   maximum (a header snapshot of the paper being saved, not the source's).
 * - No model is called, so it needs no room under the school's AI limit.
 *
 * The caller has checked the class permissions (manage on the target, read on
 * the source class) and the assistant gate.
 */
export async function copyQuestionPaperVersion(
  db: Database,
  input: {
    scope: PaperScope;
    userId: string;
    expectedVersionNo: number;
    source: PaperKey & { versionNo: number };
    signal?: AbortSignal;
  },
): Promise<SavedVersion> {
  const { versionNo, ...sourceKey } = input.source;
  assertCopySourceAllowed(input.scope.key, sourceKey);
  const sourcePaper = await findPaper(db, sourceKey);
  if (!sourcePaper || sourcePaper.schoolId !== input.scope.key.schoolId) throw copySourceNotFoundError('Question paper');
  const [version] = await db
    .select({ id: examQuestionPaperVersionTable.id, contentHtml: examQuestionPaperVersionTable.contentHtml })
    .from(examQuestionPaperVersionTable)
    .where(
      and(
        eq(examQuestionPaperVersionTable.paperId, sourcePaper.id),
        eq(examQuestionPaperVersionTable.schoolId, sourcePaper.schoolId),
        eq(examQuestionPaperVersionTable.versionNo, versionNo),
      ),
    )
    .limit(1);
  if (!version) throw copySourceNotFoundError('Question paper version');
  return saveQuestionPaperVersion(db, {
    scope: input.scope,
    userId: input.userId,
    expectedVersionNo: input.expectedVersionNo,
    html: version.contentHtml,
    source: { kind: 'copy', sourcePaperId: sourcePaper.id, sourceVersionId: version.id },
    signal: input.signal,
  });
}

/**
 * The HTML a version of this paper prints as: the school's template with the
 * paper's context (`buildPaperContext`: an exam paper's plan facts, a quick
 * paper's session and details), or the built-in shell for a `plain` paper.
 * `planMaxMarks` is what an exam paper's header shows (the version's own
 * snapshot when an old version is printed again); `details` are a quick
 * paper's details to print when a save is about to store new ones.
 */
async function renderPaperDocument(
  db: DatabaseExecutor,
  input: {
    scope: ResolvedPaper;
    template: PrintTemplate;
    body: Awaited<ReturnType<typeof renderQuestionPaperBody>>;
    versionNo: number;
    planMaxMarks: number | null;
    details?: QuestionPaperPrintedDetails;
    generatedAt?: Date;
  },
): Promise<string> {
  const { scope, template, body } = input;
  if (template.kind === 'plain' || printLayoutOf(scope) === 'plain') {
    if (template.kind !== 'plain' || printLayoutOf(scope) !== 'plain') throw new Error('A question paper and its print template are of different layouts.');
    return renderStandaloneQuestionPaperDocument(body);
  }
  const context = await measure('qp.context', () =>
    buildPaperContext(db, scope, { versionNo: input.versionNo, planMaxMarks: input.planMaxMarks, details: input.details }, input.generatedAt),
  );
  return renderQuestionPaperDocument({ template, context, body });
}

/** The artifact columns that name what a question paper PDF belongs to: the exam's, none for a standalone paper. */
const artifactScopeOf = (scope: ResolvedPaper) =>
  isStandalonePaper(scope)
    ? { sessionId: null, examSlug: null, classId: null }
    : { sessionId: scope.key.sessionId, examSlug: scope.key.examSlug, classId: scope.key.classId };

async function renderAndStore(
  db: Database,
  input: {
    scope: ResolvedPaper;
    userId: string;
    expectedVersionNo: number | null;
    source: SaveSource;
    details?: QuestionPaperDetails | 'keep';
    signal?: AbortSignal;
    versionNo: number;
    assumedLatest: number;
    checked: Extract<DraftCheck, { ok: true }>;
    template: PrintTemplate;
  },
): Promise<SavedVersion> {
  const { scope, checked, versionNo, source } = input;
  const schoolId = paperSchoolIdOf(scope);
  const planMaxMarks = planMaxMarksOf(scope);
  const paper = await findPaperOf(db, scope);
  const body = await renderQuestionPaperBody(db, {
    schoolId,
    paperId: paper?.id ?? null,
    html: checked.html,
  });
  // The details this save stores on the paper (a standalone paper's; `keep` stores none).
  const details = isStandalonePaper(scope) && input.details && input.details !== 'keep' ? input.details : undefined;
  // A quick paper's heading prints the details this very save states (its row's when the save keeps them), and the
  // version keeps them, so it prints the same later (`printed_details`).
  const printedDetails = printedDetailsOf(scope, details, paper);
  const html = await renderPaperDocument(db, { scope, template: input.template, body, versionNo, planMaxMarks, details: printedDetails ?? undefined });
  const pdf = await convertDocumentPdf(html, 'question_paper', input.signal);
  // A standalone paper's PDF is named after the details this very save states, or the paper's own when it keeps them.
  const names: PaperNames =
    !isStandalonePaper(scope) ? { kind: 'exam', scope } : input.details === 'keep' || !input.details ? await paperNamesOf(db, scope) : { kind: 'standalone', details: input.details };

  const artifactId = generateId('artifact');
  return persistDocumentObject(
    db,
    {
      id: artifactId,
      schoolId,
      kind: 'pdf',
      documentType: 'question_paper',
      name: artifactName(names, versionNo),
      s3Key: `schools/${schoolId}/documents/${artifactId}.pdf`,
      contentType: 'application/pdf',
      pageSize: 'full',
      templateRevisionId: input.template.kind === 'template' ? input.template.revisionId : null,
      ...artifactScopeOf(scope),
      studentIds: [],
      studentCount: 0,
      createdBy: input.userId,
    },
    pdf,
    async (tx, artifact) => {
      // Session share lock first, then the paper lock: a completion of the exam cannot slip in between.
      await assertResolvedPaperWritableLocked(tx, scope);
      const locked = await lockOrCreatePaperOf(tx, scope, input.userId);
      if (source.kind === 'ai_job') {
        // A job swept at its deadline (or deleted with its paper) must not commit a version afterwards. The row is
        // read FOR SHARE after the paper lock (the order every job-row writer here also keeps: the sweep and the
        // job's own transitions take the job row alone), so a sweep either lands first, refusing this save, or waits.
        const [job] = await tx
          .select({ status: examQuestionPaperJobTable.status })
          .from(examQuestionPaperJobTable)
          .where(eq(examQuestionPaperJobTable.id, source.jobId))
          .for('share');
        if (job?.status !== 'running') throw new SourceJobEndedError();
      }
      if (source.kind === 'copy') {
        // The source paper may have been deleted while the copy rendered. Held FOR KEY SHARE (what the foreign key
        // check takes anyway), so a delete either committed first and the copy is refused cleanly here, or waits.
        const [kept] = await tx
          .select({ id: examQuestionPaperVersionTable.id })
          .from(examQuestionPaperVersionTable)
          .where(and(eq(examQuestionPaperVersionTable.id, source.sourceVersionId), eq(examQuestionPaperVersionTable.schoolId, schoolId)))
          .for('key share');
        if (!kept) throw copySourceNotFoundError('Question paper version');
      }
      if (locked.latestVersionNo !== input.assumedLatest) {
        if (input.expectedVersionNo !== null) {
          throw rpcError.conflict(`The paper changed: its latest version is ${locked.latestVersionNo}, not ${input.expectedVersionNo}. Read it again with getQuestionPaper.`);
        }
        throw new VersionRaceError();
      }
      // The figures were validated against the paper as it was before the lock; it is the same paper (same id).
      if (paper && paper.id !== locked.id) throw new VersionRaceError();
      if (isStandalonePaper(scope)) await assertStandaloneSaveRoom(tx, scope, source, true, artifact.byteSize, locked.id);
      await tx.insert(examQuestionPaperVersionTable).values({
        paperId: locked.id,
        paperKind: locked.kind,
        paperPrintLayout: locked.printLayout,
        schoolId,
        versionNo,
        contentHtml: checked.html,
        contentSha256: questionPaperContentSha256(checked.html),
        source: source.kind,
        sourceJobId: source.kind === 'ai_job' ? source.jobId : null,
        sourcePageIds: source.kind === 'ai_job' ? source.pageIds : null,
        sourceConversationId: source.kind === 'agent' ? source.conversationId : null,
        sourceVersionId: source.kind === 'copy' ? source.sourceVersionId : null,
        planMaxMarks,
        printedDetails,
        warnings: checked.notices,
        templateRevisionId: input.template.kind === 'template' ? input.template.revisionId : null,
        pdfArtifactId: artifact.id,
        createdBy: input.userId,
      });
      // A standalone paper's details are not revisioned: this save's details replace all five, in this transaction
      // (`keep`: a version that states none leaves them as they are).
      await tx
        .update(examQuestionPaperTable)
        .set({
          latestVersionNo: versionNo,
          updatedAt: new Date(),
          ...(details
            ? {
                detailsSchoolName: details.schoolName,
                detailsClassName: details.className,
                detailsSubjectName: details.subjectName,
                detailsExamName: details.examName,
                detailsMaxMarks: details.maxMarks,
              }
            : {}),
        })
        .where(eq(examQuestionPaperTable.id, locked.id));
      return {
        versionNo,
        paperId: locked.id,
        planMaxMarks,
        warnings: checked.notices,
        hasPdf: true as const,
        replayed: false,
      };
    },
  );
}

/** A saved version of a paper, or NOT_FOUND. */
export async function getVersion(db: DatabaseExecutor, paperId: string, versionNo: number): Promise<VersionRow> {
  const [version] = await db
    .select()
    .from(examQuestionPaperVersionTable)
    .where(and(eq(examQuestionPaperVersionTable.paperId, paperId), eq(examQuestionPaperVersionTable.versionNo, versionNo)))
    .limit(1);
  if (!version) throw rpcError.notFound('Question paper version');
  return version;
}

/**
 * The full HTML of a saved version, rendered with the template revision it
 * pinned, so previewing an old version shows what its PDF shows even after
 * the school changed its template.
 */
export async function renderStoredVersionHtml(
  db: DatabaseExecutor,
  scope: ResolvedPaper,
  version: VersionRow,
  generatedAt: Date = new Date(),
): Promise<{ html: string; templateName: string | null }> {
  const schoolId = paperSchoolIdOf(scope);
  const template = await pinnedPrintTemplateOf(db, scope, version);
  const body = await renderQuestionPaperBody(db, { schoolId, paperId: version.paperId, html: version.contentHtml });
  // The maximum marks are the saved fact (`plan_max_marks`), not the plan as it is today: an edited plan must not change
  // an old version's preview or a restored PDF. Class, subject, mode and exam names still come from the live scope.
  const html = await renderPaperDocument(db, {
    scope,
    template,
    body,
    versionNo: version.versionNo,
    planMaxMarks: version.planMaxMarks,
    details: version.printedDetails ?? undefined,
    generatedAt,
  });
  return { html, templateName: template.kind === 'template' ? template.name : null };
}

/**
 * The template a stored version prints with again: the revision it pinned
 * (a paper that prints with its school's template), or the built-in shell (a
 * `plain` paper, whose versions pin none: `exam_question_paper_version_template_check`).
 */
async function pinnedPrintTemplateOf(db: DatabaseExecutor, scope: ResolvedPaper, version: VersionRow): Promise<PrintTemplate> {
  if (printLayoutOf(scope) === 'plain') return { kind: 'plain' };
  if (version.templateRevisionId === null) throw new Error(`Question paper version ${version.id} has no template revision.`);
  return { kind: 'template', ...(await readPinnedQuestionPaperTemplate(db, paperSchoolIdOf(scope), version.templateRevisionId)) };
}

/** A concurrent download stored a PDF for the same version first; this one is discarded. */
class PdfAlreadyStoredError extends Error {}

/**
 * The storage key of a version's PDF. The PDF stored when the version was
 * saved is used; if its artifact was deleted (the pointer is then null) the
 * version is printed again from its fragment and its pinned template, and the
 * new artifact becomes its PDF. Two requests racing to restore the PDF keep
 * the first and discard the second.
 */
export async function storedVersionPdfKey(
  db: Database,
  input: { scope: ResolvedPaper; version: VersionRow; userId: string; signal?: AbortSignal },
): Promise<string> {
  const { scope } = input;
  let version = input.version;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (version.pdfArtifactId) {
      const [artifact] = await db
        .select({ s3Key: artifactTable.s3Key, status: artifactTable.status })
        .from(artifactTable)
        .where(and(eq(artifactTable.id, version.pdfArtifactId), eq(artifactTable.schoolId, paperSchoolIdOf(scope))))
        .limit(1);
      if (artifact?.status === 'ready') return artifact.s3Key;
    }
    const restored = await restoreVersionPdf(db, { ...input, version }).catch((error: unknown) => {
      if (error instanceof PdfAlreadyStoredError) return null;
      throw error;
    });
    if (restored) return restored;
    version = await getVersion(db, version.paperId, version.versionNo);
  }
  throw rpcError.conflict('The PDF of this version is being restored. Try again.');
}

/** A short-lived download URL for a version's PDF ({@link storedVersionPdfKey}). */
export async function downloadVersionPdf(
  db: Database,
  input: { scope: ResolvedPaper; version: VersionRow; userId: string; signal?: AbortSignal },
): Promise<{ url: string; fileName: string }> {
  const s3Key = await storedVersionPdfKey(db, input);
  const fileName = downloadFileName(await versionNamesOf(db, input.scope, input.version), input.version.versionNo);
  return { url: await documentDownloadUrl(s3Key, fileName), fileName: `${fileName}.pdf` };
}

/** The format a version is downloaded in: its PDF (the default), or an editable Word file. */
export type VersionDownloadFormat = 'pdf' | 'docx';

/** A short-lived download URL for a version in the format asked for ({@link downloadVersionPdf}, {@link downloadVersionDocx}). */
export function downloadVersion(
  db: Database,
  input: { scope: ResolvedPaper; version: VersionRow; userId: string; format: VersionDownloadFormat; signal?: AbortSignal },
): Promise<{ url: string; fileName: string }> {
  return input.format === 'docx' ? downloadVersionDocx(db, input) : downloadVersionPdf(db, input);
}

/** Prints the version again and stores the PDF as its artifact; answers with the new object's key. */
async function restoreVersionPdf(
  db: Database,
  input: { scope: ResolvedPaper; version: VersionRow; userId: string; signal?: AbortSignal },
): Promise<string> {
  const { scope, version } = input;
  const schoolId = paperSchoolIdOf(scope);
  const { html } = await renderStoredVersionHtml(db, scope, version);
  const pdf = await convertDocumentPdf(html, 'question_paper', input.signal);
  const artifactId = generateId('artifact');
  const name = artifactName(await versionNamesOf(db, scope, version), version.versionNo);
  const s3Key = `schools/${schoolId}/documents/${artifactId}.pdf`;
  await persistDocumentObject(
    db,
    {
      id: artifactId,
      schoolId,
      kind: 'pdf',
      documentType: 'question_paper',
      name,
      s3Key,
      contentType: 'application/pdf',
      pageSize: 'full',
      templateRevisionId: version.templateRevisionId,
      ...artifactScopeOf(scope),
      studentIds: [],
      studentCount: 0,
      createdBy: input.userId,
    },
    pdf,
    async (tx, artifact) => {
      const stillWithout = version.pdfArtifactId
        ? eq(examQuestionPaperVersionTable.pdfArtifactId, version.pdfArtifactId)
        : isNull(examQuestionPaperVersionTable.pdfArtifactId);
      const updated = await tx
        .update(examQuestionPaperVersionTable)
        .set({ pdfArtifactId: artifact.id })
        .where(and(eq(examQuestionPaperVersionTable.id, version.id), stillWithout))
        .returning({ id: examQuestionPaperVersionTable.id });
      if (updated.length === 0) throw new PdfAlreadyStoredError();
    },
  );
  return s3Key;
}

/** A concurrent download stored a Word file for the same version first; this one is discarded. */
class DocxAlreadyStoredError extends Error {}

/**
 * The storage key of a version's Word (.docx) file (docs/question-papers.md
 * "Word download"). It is made on the version's FIRST Word download, from the
 * same inputs as its PDF (the stored fragment, the paper's own figures, the
 * pinned template revision or the standalone shell), stored as an artifact
 * of kind `docx` and reused by every later download. A Word file whose
 * artifact was deleted (the pointer is then null) is made again. Two first
 * downloads racing keep the first file and discard the second, like
 * {@link storedVersionPdfKey}.
 *
 * A download is a read (a suspended school or a personal space past its
 * trial can still download), and making the file is part of answering it, as
 * restoring a removed PDF is. Concurrent first downloads of one version share
 * one conversion in this process, within one deadline, at most two
 * conversions at a time (`sharedDocxConversion`). In a personal space the file counts toward the
 * storage quota like the version's PDF: a full space is refused
 * (`PERSONAL_SPACE_STORAGE_FULL`) before anything is converted, and again in
 * the transaction that records it.
 */
export async function storedVersionDocxKey(
  db: Database,
  input: { scope: ResolvedPaper; version: VersionRow; userId: string; signal?: AbortSignal },
): Promise<string> {
  const { scope } = input;
  let version = input.version;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (version.docxArtifactId) {
      const [artifact] = await db
        .select({ s3Key: artifactTable.s3Key, status: artifactTable.status })
        .from(artifactTable)
        .where(and(eq(artifactTable.id, version.docxArtifactId), eq(artifactTable.schoolId, paperSchoolIdOf(scope))))
        .limit(1);
      if (artifact?.status === 'ready') return artifact.s3Key;
    }
    const current = version;
    // Early look: a full personal space is refused before any conversion (any other school has no quota).
    await assertPersonalSpaceStorageRoom(db, { schoolId: paperSchoolIdOf(scope), addedBytes: 0, lock: false });
    const made = await sharedDocxConversion(current.id, input.signal, (deadline) =>
      makeVersionDocx(db, { scope, version: current, userId: input.userId, deadline }),
    ).catch((error: unknown) => {
      if (error instanceof DocxAlreadyStoredError) return null;
      throw error;
    });
    if (made) return made;
    version = await getVersion(db, version.paperId, version.versionNo);
  }
  throw rpcError.conflict('The Word file of this version is being prepared. Try again.');
}

/** A short-lived download URL for a version's Word file ({@link storedVersionDocxKey}), named like its PDF. */
export async function downloadVersionDocx(
  db: Database,
  input: { scope: ResolvedPaper; version: VersionRow; userId: string; signal?: AbortSignal },
): Promise<{ url: string; fileName: string }> {
  const s3Key = await storedVersionDocxKey(db, input);
  const fileName = downloadFileName(await versionNamesOf(db, input.scope, input.version), input.version.versionNo);
  return { url: await documentDownloadUrl(s3Key, fileName, 'docx'), fileName: `${fileName}.docx` };
}

/**
 * The rendered template document of a stored version with the body slot still
 * in place, exactly as its PDF prints around the body: the pinned revision with
 * the version's own context (an exam paper), or the built-in shell (a
 * standalone paper).
 */
async function storedVersionTemplateHtml(db: DatabaseExecutor, scope: ResolvedPaper, version: VersionRow): Promise<string> {
  const template = await pinnedPrintTemplateOf(db, scope, version);
  if (template.kind === 'plain') return renderStandaloneQuestionPaperShell();
  const context = await measure('qp.context', () =>
    buildPaperContext(db, scope, { versionNo: version.versionNo, planMaxMarks: version.planMaxMarks, details: version.printedDetails ?? undefined }),
  );
  return measure('qp.document.render', () => renderQuestionPaperTemplate(template.content, context));
}

/** Converts the version to Word and stores the file as its artifact; answers with the new object's key. `deadline` ends the whole of it. */
async function makeVersionDocx(
  db: Database,
  input: { scope: ResolvedPaper; version: VersionRow; userId: string; deadline: AbortSignal },
): Promise<string> {
  const { scope, version } = input;
  const schoolId = paperSchoolIdOf(scope);
  const template = await storedVersionTemplateHtml(db, scope, version);
  const figures = await measure('qp.figures.load', () =>
    loadFigureAssets(db, { schoolId, paperId: version.paperId, figureIds: fragmentFigureIds(version.contentHtml) }),
  );
  const html = measure('qp.docx.html', () => questionPaperDocxHtml({ fragment: version.contentHtml, figures, template }));
  const docx = await convertQuestionPaperDocx(html, input.deadline);
  input.deadline.throwIfAborted();
  const artifactId = generateId('artifact');
  const s3Key = `schools/${schoolId}/documents/${artifactId}.docx`;
  await persistDocumentObject(
    db,
    {
      id: artifactId,
      schoolId,
      kind: 'docx',
      documentType: 'question_paper',
      name: artifactName(await versionNamesOf(db, scope, version), version.versionNo),
      s3Key,
      contentType: DOCX_CONTENT_TYPE,
      pageSize: 'full',
      templateRevisionId: version.templateRevisionId,
      ...artifactScopeOf(scope),
      studentIds: [],
      studentCount: 0,
      createdBy: input.userId,
    },
    docx,
    async (tx, artifact) => {
      await assertPersonalSpaceStorageRoom(tx, { schoolId, addedBytes: artifact.byteSize, lock: true });
      const stillWithout = version.docxArtifactId
        ? eq(examQuestionPaperVersionTable.docxArtifactId, version.docxArtifactId)
        : isNull(examQuestionPaperVersionTable.docxArtifactId);
      const updated = await tx
        .update(examQuestionPaperVersionTable)
        .set({ docxArtifactId: artifact.id })
        .where(and(eq(examQuestionPaperVersionTable.id, version.id), stillWithout))
        .returning({ id: examQuestionPaperVersionTable.id });
      if (updated.length === 0) throw new DocxAlreadyStoredError();
    },
  );
  return s3Key;
}

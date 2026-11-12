import type { Database, DatabaseExecutor } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import { assistantConversationTable, assistantItemTable } from '@campuspilot/db/schema/assistant';
import { generateId } from '@campuspilot/db/id';
import {
  examQuestionPaperFigureTable,
  examQuestionPaperJobTable,
  examQuestionPaperTable,
  examQuestionPaperVersionTable,
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
import { documentDownloadUrl, persistDocumentObject } from '../document/document.storage';
import { attachmentFigureIds, attachmentFigureProblems, convertAttachmentFigures, isAttachmentFigureId } from './question-paper.attachments';
import { buildQuestionPaperContext } from './question-paper.context';
import { createMathRenderer, renderMathSpans } from './question-paper.math';
import {
  findPaper,
  lockOrCreatePaper,
  templateMissingError,
  type PaperRow,
  type VersionRow,
} from './question-paper.records';
import { figureIdsToPlaceholders } from './question-paper.body';
import {
  QUESTION_PAPER_BODY_MAX_BYTES,
  QUESTION_PAPER_FIGURES_MAX_BYTES,
  readPinnedQuestionPaperTemplate,
  renderQuestionPaperBody,
  renderQuestionPaperDocument,
  selectedQuestionPaperTemplate,
} from './question-paper.render';
import { sanitizeQuestionPaperBody, type SanitizedQuestionPaperBody } from './question-paper.sanitize';
import { assertPaperWritable, assertPaperWritableLocked, type PaperScope } from './question-paper.scope';

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
 * must name a stored figure of this paper, or a chat attachment of
 * `chatUserId` (`asat_` id; see `question-paper.attachments.ts`): an
 * attachment is checked here and copied into a figure only when a version is
 * saved.
 */
async function figureProblems(
  db: DatabaseExecutor,
  input: { schoolId: string; paper: PaperRow | undefined; chatUserId: string | undefined },
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
    chatUserId: input.chatUserId,
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
 * The printer embeds every figure as a base64 data URI under one cap
 * (`loadFigureAssets`): total it here, so a draft that validates can also be
 * printed. A chat image becomes a figure of at most about FIGURE_MAX_BYTES.
 */
async function figureSizeProblem(db: DatabaseExecutor, paper: PaperRow | undefined, ids: readonly string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  const rows = paper
    ? await db
        .select({ id: examQuestionPaperFigureTable.id, contentType: examQuestionPaperFigureTable.contentType, byteSize: examQuestionPaperFigureTable.byteSize })
        .from(examQuestionPaperFigureTable)
        .where(and(eq(examQuestionPaperFigureTable.paperId, paper.id), eq(examQuestionPaperFigureTable.schoolId, paper.schoolId)))
    : [];
  const sizeOf = new Map(rows.map((row) => [row.id, `data:${row.contentType};base64,`.length + encodedImageBytes(row.byteSize)]));
  const embedded = ids.reduce((sum, id) => sum + (sizeOf.get(id) ?? encodedImageBytes(FIGURE_MAX_BYTES)), 0);
  return embedded > QUESTION_PAPER_FIGURES_MAX_BYTES ? 'The figure images of this paper are too large to print together. Use fewer or smaller images.' : null;
}

/** Whether a cleaned fragment prints anything: text, a drawing, a formula or a figure. */
function hasContent({ html, stats }: SanitizedQuestionPaperBody): boolean {
  if (stats.mathNodes > 0 || stats.figureIds.length > 0 || stats.placeholders > 0 || stats.svgs > 0) return true;
  return html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, '').trim() !== '';
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
  scope: PaperScope,
  raw: string,
  options: {
    /** The chat user whose attachments the fragment may use as figures; omitted outside the in-app assistant. */
    chatUserId?: string;
    unresolvedFigures?: UnresolvedFigures;
  } = {},
): Promise<DraftCheck> {
  const canonical = canonicalQuestionPaperHtml(raw);
  let sanitized = sanitizeQuestionPaperBody(canonical);
  const stripped = [...sanitized.stripped];
  if (sanitized.problems.length > 0) return { ok: false, problems: sanitized.problems, stripped };

  const problems: string[] = [];
  if (!hasContent(sanitized)) problems.push('The paper is empty. Write the questions as HTML.');

  const paper = await findPaper(db, scope.key);
  const unusable = await figureProblems(db, { schoolId: scope.key.schoolId, paper, chatUserId: options.chatUserId }, sanitized.stats.figureIds);
  if (unusable.size > 0) {
    if (options.unresolvedFigures === 'placeholder') {
      sanitized = sanitizeQuestionPaperBody(figureIdsToPlaceholders(sanitized.html, new Set(unusable.keys())));
      stripped.push(`${unusable.size} figure ${unusable.size === 1 ? 'image' : 'images'} could not be attached and became ${unusable.size === 1 ? 'a placeholder' : 'placeholders'}`);
    } else {
      for (const [id, problem] of unusable) problems.push(`Figure ${id}: ${problem}`);
    }
  } else {
    const size = await figureSizeProblem(db, paper, sanitized.stats.figureIds);
    if (size) problems.push(size);
  }

  const math = createMathRenderer();
  const typeset = renderMathSpans(sanitized.html, math);
  for (const failure of typeset.failures) {
    problems.push(`Formula ${failure.index} (${failure.tex.slice(0, 60)}): ${failure.message}`);
  }
  // KaTeX HTML is large (tens of KB for one nested formula): count it here so a draft that validates can also be
  // printed, the same limit the body render enforces on the whole body.
  if (typeset.failures.length === 0 && math.renderedBytes() > QUESTION_PAPER_BODY_MAX_BYTES) {
    problems.push('The formulas of this paper are too large to print. Shorten or remove some formulas.');
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

const DRAFT_TOOL_NAME = /(^|[._])validateQuestionPaperDraft$/;
/** How many of a conversation's newest tool calls are searched for a draft. */
const DRAFT_SEARCH_DEPTH = 60;

/**
 * Finds the HTML a chat agent validated earlier in this conversation
 * (design E7): the newest `validateQuestionPaperDraft` tool call whose input
 * `html` hashes to `draftId`. A draft is not a database row; the chat transcript is
 * its only home, which is why this reads the assistant's items, scoped to the
 * conversation, its school and its user. External clients have no
 * conversation and pass `html` instead.
 */
export async function findChatDraftContent(
  db: DatabaseExecutor,
  input: { conversationId: string; schoolId: string; userId: string; draftId: string },
): Promise<string> {
  const [conversation] = await db
    .select({ id: assistantConversationTable.id })
    .from(assistantConversationTable)
    .where(
      and(
        eq(assistantConversationTable.id, input.conversationId),
        eq(assistantConversationTable.schoolId, input.schoolId),
        eq(assistantConversationTable.userId, input.userId),
        isNull(assistantConversationTable.deletedAt),
      ),
    )
    .limit(1);
  const notFound = rpcError.badRequest('No draft with that draftId was validated in this conversation. Send the full html instead.');
  if (!conversation) throw notFound;
  const items = await db
    .select({ body: assistantItemTable.body })
    .from(assistantItemTable)
    .where(and(eq(assistantItemTable.conversationId, conversation.id), eq(assistantItemTable.kind, 'tool_call')))
    .orderBy(desc(assistantItemTable.position))
    .limit(DRAFT_SEARCH_DEPTH);
  for (const { body } of items) {
    const call = body as { toolName?: unknown; input?: unknown };
    if (typeof call.toolName !== 'string' || !DRAFT_TOOL_NAME.test(call.toolName)) continue;
    const html = (call.input as { html?: unknown } | null)?.html;
    if (typeof html === 'string' && questionPaperDraftId(html) === input.draftId) return html;
  }
  throw notFound;
}

export type SaveSource =
  | { kind: 'agent'; conversationId: string | null }
  | { kind: 'ai_job'; jobId: string; pageIds: string[] };

export type SavedVersion = {
  versionNo: number;
  paperId: string;
  planMaxMarks: number;
  warnings: QuestionPaperNotice[];
  hasPdf: true;
  /** True when this job had already saved its version and nothing was written. */
  replayed: boolean;
};

/** Another version landed between a job's render and its commit: render again with the new number. */
class VersionRaceError extends Error {}

/** The generation job that is saving this version ended (swept at its deadline, deleted) before the save committed. */
export class SourceJobEndedError extends Error {}

const artifactName = (scope: PaperScope, versionNo: number) =>
  `Question paper: ${scope.subjectName} (${scope.modeName}) - ${scope.className} - v${versionNo}`;

async function savedByJob(db: DatabaseExecutor, jobId: string): Promise<VersionRow | undefined> {
  const [version] = await db
    .select()
    .from(examQuestionPaperVersionTable)
    .where(eq(examQuestionPaperVersionTable.sourceJobId, jobId))
    .limit(1);
  return version;
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

const savedResult = (version: VersionRow, planMaxMarks: number): SavedVersion => ({
  versionNo: version.versionNo,
  paperId: version.paperId,
  planMaxMarks: version.planMaxMarks ?? planMaxMarks,
  warnings: version.warnings,
  hasPdf: true,
  replayed: true,
});

/**
 * Saves a new immutable version of a paper: the one function behind the agent
 * tool and the AI job, so both validate, render, print and number exactly the
 * same way.
 *
 * - The document is checked ({@link checkQuestionPaperDraft}); errors refuse.
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
    scope: PaperScope;
    userId: string;
    expectedVersionNo: number | null;
    /** The fragment as written; it is cleaned and checked here. */
    html: string;
    source: SaveSource;
    signal?: AbortSignal;
  },
): Promise<SavedVersion> {
  const { scope, source } = input;
  if (source.kind === 'ai_job') {
    const done = await savedByJob(db, source.jobId);
    if (done) return savedResult(done, scope.planMaxMarks);
  }
  assertPaperWritable(scope);
  // Chat attachments may be figures only when an agent saves from a chat. The AI job has no way to attach an
  // image, so a figure id it cannot resolve becomes a placeholder; an agent is told and fixes it.
  const chatUserId = source.kind === 'agent' && source.conversationId ? input.userId : undefined;
  const unresolvedFigures: UnresolvedFigures = source.kind === 'ai_job' ? 'placeholder' : 'problem';
  let checked = await checkQuestionPaperDraft(db, scope, input.html, { chatUserId, unresolvedFigures });
  if (!checked.ok) throw invalidPaperError(checked.problems);
  if (attachmentFigureIds(checked.html).length > 0) {
    // Refuse a stale expectedVersionNo before anything is copied: a refused save must not leave figure rows behind.
    if (input.expectedVersionNo !== null) {
      const latest = (await findPaper(db, scope.key))?.latestVersionNo ?? 0;
      if (input.expectedVersionNo !== latest) {
        throw rpcError.conflict(`The paper changed: its latest version is ${latest}, not ${input.expectedVersionNo}. Read it again with getQuestionPaper.`);
      }
    }
    // Copy the attachments into the paper and store the version with its own figure ids; the fragment is
    // checked again as it will be stored. The notices of the first check are the ones the user is told about.
    const { notices, stripped } = checked;
    const converted = await checkQuestionPaperDraft(db, scope, await convertAttachmentFigures(db, { scope, userId: input.userId, html: checked.html }));
    if (!converted.ok) throw invalidPaperError(converted.problems);
    checked = { ...converted, notices, stripped };
  }
  const template = await selectedQuestionPaperTemplate(db, scope.key.schoolId);
  if (!template) throw templateMissingError();

  for (let attempt = 1; ; attempt += 1) {
    const paper = await findPaper(db, scope.key);
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
        if (done) return savedResult(done, scope.planMaxMarks);
      }
      throw error;
    }
  }
}

async function renderAndStore(
  db: Database,
  input: {
    scope: PaperScope;
    userId: string;
    expectedVersionNo: number | null;
    source: SaveSource;
    signal?: AbortSignal;
    versionNo: number;
    assumedLatest: number;
    checked: Extract<DraftCheck, { ok: true }>;
    template: { revisionId: string; content: string };
  },
): Promise<SavedVersion> {
  const { scope, checked, versionNo, source } = input;
  const paper = await findPaper(db, scope.key);
  const body = await renderQuestionPaperBody(db, {
    schoolId: scope.key.schoolId,
    paperId: paper?.id ?? null,
    html: checked.html,
  });
  const context = await buildQuestionPaperContext(db, scope, { versionNo });
  const html = renderQuestionPaperDocument({ template: input.template, context, body });
  const pdf = await convertDocumentPdf(html, 'question_paper', input.signal);

  const artifactId = generateId('artifact');
  return persistDocumentObject(
    db,
    {
      id: artifactId,
      schoolId: scope.key.schoolId,
      kind: 'pdf',
      documentType: 'question_paper',
      name: artifactName(scope, versionNo),
      s3Key: `schools/${scope.key.schoolId}/documents/${artifactId}.pdf`,
      contentType: 'application/pdf',
      pageSize: 'full',
      templateRevisionId: input.template.revisionId,
      sessionId: scope.key.sessionId,
      examSlug: scope.key.examSlug,
      classId: scope.key.classId,
      studentIds: [],
      studentCount: 0,
      createdBy: input.userId,
    },
    pdf,
    async (tx, artifact) => {
      // Session share lock first, then the paper lock: a completion of the exam cannot slip in between.
      await assertPaperWritableLocked(tx, scope.key);
      const locked = await lockOrCreatePaper(tx, scope.key, input.userId);
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
      if (locked.latestVersionNo !== input.assumedLatest) {
        if (input.expectedVersionNo !== null) {
          throw rpcError.conflict(`The paper changed: its latest version is ${locked.latestVersionNo}, not ${input.expectedVersionNo}. Read it again with getQuestionPaper.`);
        }
        throw new VersionRaceError();
      }
      // The figures were validated against the paper as it was before the lock; it is the same paper (same id).
      if (paper && paper.id !== locked.id) throw new VersionRaceError();
      await tx.insert(examQuestionPaperVersionTable).values({
        paperId: locked.id,
        schoolId: scope.key.schoolId,
        versionNo,
        contentHtml: checked.html,
        contentSha256: questionPaperContentSha256(checked.html),
        source: source.kind,
        sourceJobId: source.kind === 'ai_job' ? source.jobId : null,
        sourcePageIds: source.kind === 'ai_job' ? source.pageIds : null,
        sourceConversationId: source.kind === 'agent' ? source.conversationId : null,
        planMaxMarks: scope.planMaxMarks,
        warnings: checked.notices,
        templateRevisionId: input.template.revisionId,
        pdfArtifactId: artifact.id,
        createdBy: input.userId,
      });
      await tx
        .update(examQuestionPaperTable)
        .set({ latestVersionNo: versionNo, updatedAt: new Date() })
        .where(eq(examQuestionPaperTable.id, locked.id));
      return {
        versionNo,
        paperId: locked.id,
        planMaxMarks: scope.planMaxMarks,
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
  scope: PaperScope,
  version: VersionRow,
  generatedAt: Date = new Date(),
): Promise<{ html: string; templateName: string }> {
  const template = await readPinnedQuestionPaperTemplate(db, scope.key.schoolId, version.templateRevisionId);
  const body = await renderQuestionPaperBody(db, { schoolId: scope.key.schoolId, paperId: version.paperId, html: version.contentHtml });
  // The maximum marks are the saved fact (`plan_max_marks`), not the plan as it is today: an edited plan must not change
  // an old version's preview or a restored PDF. Class, subject, mode and exam names still come from the live scope.
  const context = await buildQuestionPaperContext(
    db,
    { ...scope, planMaxMarks: version.planMaxMarks ?? scope.planMaxMarks },
    { versionNo: version.versionNo },
    generatedAt,
  );
  return { html: renderQuestionPaperDocument({ template, context, body }), templateName: template.name };
}

/** A concurrent download stored a PDF for the same version first; this one is discarded. */
class PdfAlreadyStoredError extends Error {}

/**
 * A short-lived download URL for a version's PDF. The PDF stored when the
 * version was saved is served; if its artifact was deleted (the pointer is
 * then null) the version is printed again from its fragment and its pinned
 * template, and the new artifact becomes its PDF. Two downloads racing to
 * restore the PDF keep the first and discard the second.
 */
export async function downloadVersionPdf(
  db: Database,
  input: { scope: PaperScope; version: VersionRow; userId: string; signal?: AbortSignal },
): Promise<{ url: string; fileName: string }> {
  const { scope } = input;
  let version = input.version;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (version.pdfArtifactId) {
      const [artifact] = await db
        .select({ s3Key: artifactTable.s3Key, name: artifactTable.name, status: artifactTable.status })
        .from(artifactTable)
        .where(and(eq(artifactTable.id, version.pdfArtifactId), eq(artifactTable.schoolId, scope.key.schoolId)))
        .limit(1);
      if (artifact?.status === 'ready') {
        return { url: await documentDownloadUrl(artifact.s3Key, artifact.name), fileName: `${artifact.name}.pdf` };
      }
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

async function restoreVersionPdf(
  db: Database,
  input: { scope: PaperScope; version: VersionRow; userId: string; signal?: AbortSignal },
): Promise<{ url: string; fileName: string }> {
  const { scope, version } = input;
  const { html } = await renderStoredVersionHtml(db, scope, version);
  const pdf = await convertDocumentPdf(html, 'question_paper', input.signal);
  const artifactId = generateId('artifact');
  const name = artifactName(scope, version.versionNo);
  const s3Key = `schools/${scope.key.schoolId}/documents/${artifactId}.pdf`;
  await persistDocumentObject(
    db,
    {
      id: artifactId,
      schoolId: scope.key.schoolId,
      kind: 'pdf',
      documentType: 'question_paper',
      name,
      s3Key,
      contentType: 'application/pdf',
      pageSize: 'full',
      templateRevisionId: version.templateRevisionId,
      sessionId: scope.key.sessionId,
      examSlug: scope.key.examSlug,
      classId: scope.key.classId,
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
  return { url: await documentDownloadUrl(s3Key, name), fileName: `${name}.pdf` };
}

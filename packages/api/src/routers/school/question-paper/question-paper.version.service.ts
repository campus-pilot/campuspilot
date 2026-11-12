import type { Database, DatabaseExecutor } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import { assistantConversationTable, assistantItemTable } from '@campuspilot/db/schema/assistant';
import { generateId } from '@campuspilot/db/id';
import {
  examQuestionPaperFigureTable,
  examQuestionPaperTable,
  examQuestionPaperVersionTable,
} from '@campuspilot/db/schema/exam-question-paper';
import { QUESTION_PAPER_LIMITS } from '@campuspilot/question-paper/limits';
import { computePaperMarks, paperWarnings, type QuestionPaperWarning } from '@campuspilot/question-paper/marks';
import {
  canonicalQuestionPaperJson,
  normalizeQuestionPaper,
  questionPaperContentSha256,
  questionPaperDraftId,
  type QuestionPaperIssue,
} from '@campuspilot/question-paper/normalize';
import type { QuestionPaper } from '@campuspilot/question-paper/schema';
import { formatPath, walkPaper } from '@campuspilot/question-paper/walk';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { rpcError } from '../../../errors';
import { convertDocumentPdf } from '../document/document.render';
import { documentDownloadUrl, persistDocumentObject } from '../document/document.storage';
import { lifecycleWhere } from '../exam/exam.scope';
import { examLifecycleTable } from '@campuspilot/db/schema/exam';
import { attachmentFigureIds, attachmentFigureProblems, convertAttachmentFigures, isAttachmentFigureId } from './question-paper.attachments';
import { buildQuestionPaperContext } from './question-paper.context';
import type { PaperKey } from './question-paper.dto';
import { createMathRenderer, validatePaperMath } from './question-paper.math';
import {
  findPaper,
  lockOrCreatePaper,
  templateMissingError,
  type PaperRow,
  type VersionRow,
} from './question-paper.records';
import {
  readPinnedQuestionPaperTemplate,
  renderQuestionPaperBody,
  renderQuestionPaperDocument,
  selectedQuestionPaperTemplate,
} from './question-paper.render';
import { assertPaperWritable, type PaperScope } from './question-paper.scope';

/** The most validation errors one refusal message lists. */
const MAX_LISTED_ERRORS = 10;
/** How often a job's save is re-rendered when another version lands between its render and its commit. */
const MAX_JOB_SAVE_ATTEMPTS = 3;

/**
 * The checked form of a document an agent or the AI job wrote. `ok: false`
 * lists every finding with a path so a model can fix it in one round.
 */
export type DraftCheck =
  | {
      ok: true;
      content: QuestionPaper;
      warnings: QuestionPaperWarning[];
      total: number;
      draftId: string;
      placeholderFigures: number;
      characters: number;
    }
  | { ok: false; errors: QuestionPaperIssue[] };

/**
 * A figure `imageId` must name a stored figure of this paper, or a chat
 * attachment of `chatUserId` (`asat_` id; see `question-paper.attachments.ts`):
 * an attachment is checked here and copied into a figure only when a version
 * is saved.
 */
async function figureIssues(
  db: DatabaseExecutor,
  input: { schoolId: string; paper: PaperRow | undefined; chatUserId: string | undefined },
  content: QuestionPaper,
): Promise<QuestionPaperIssue[]> {
  const { paper } = input;
  const refs: Array<{ path: string; imageId: string }> = [];
  walkPaper(content, {
    block(block, path) {
      if (block.type === 'figure') refs.push({ path: `${formatPath(path)}.imageId`, imageId: block.imageId });
    },
  });
  if (refs.length === 0) return [];
  const stored = paper
    ? new Set(
        (
          await db
            .select({ id: examQuestionPaperFigureTable.id })
            .from(examQuestionPaperFigureTable)
            .where(and(eq(examQuestionPaperFigureTable.paperId, paper.id), eq(examQuestionPaperFigureTable.schoolId, paper.schoolId)))
        ).map((row) => row.id),
      )
    : new Set<string>();
  const problems = await attachmentFigureProblems(db, {
    schoolId: input.schoolId,
    chatUserId: input.chatUserId,
    ids: attachmentFigureIds(content),
  });
  return refs.flatMap(({ path, imageId }): QuestionPaperIssue[] => {
    if (isAttachmentFigureId(imageId)) {
      const problem = problems.get(imageId);
      return problem ? [{ path, message: problem }] : [];
    }
    return stored.has(imageId) ? [] : [{ path, message: 'This figure image does not belong to this paper.' }];
  });
}

/**
 * Validates untrusted JSON as a question paper of this plan, persisting
 * nothing: size, the document schema and its cross checks, every formula
 * with KaTeX, every figure id, then the marks warnings against the plan's
 * maximum. The same function guards `validateQuestionPaperDraft`, the save
 * and the AI job, so a draft that validated saves and a save cannot be
 * weaker than a validation.
 */
export async function checkQuestionPaperDraft(
  db: DatabaseExecutor,
  scope: PaperScope,
  raw: unknown,
  /** The chat user whose attachments the document may use as figures; omitted outside the in-app assistant. */
  options: { chatUserId?: string } = {},
): Promise<DraftCheck> {
  const characters = JSON.stringify(raw)?.length ?? 0;
  if (characters > QUESTION_PAPER_LIMITS.jsonChars) {
    return { ok: false, errors: [{ path: '', message: `The paper is ${characters.toLocaleString('en-IN')} characters of JSON; the limit is ${QUESTION_PAPER_LIMITS.jsonChars.toLocaleString('en-IN')}.` }] };
  }
  const normalized = normalizeQuestionPaper(raw);
  if (!normalized.ok) return { ok: false, errors: normalized.errors };
  const content = normalized.value;
  const errors = [
    ...validatePaperMath(content, createMathRenderer()),
    ...(await figureIssues(db, { schoolId: scope.key.schoolId, paper: await findPaper(db, scope.key), chatUserId: options.chatUserId }, content)),
  ];
  if (errors.length > 0) return { ok: false, errors };
  let placeholderFigures = 0;
  walkPaper(content, {
    block(block) {
      if (block.type === 'figure_placeholder') placeholderFigures += 1;
    },
  });
  return {
    ok: true,
    content,
    warnings: paperWarnings(content, { planMaxMarks: scope.planMaxMarks }),
    total: computePaperMarks(content).total,
    draftId: questionPaperDraftId(content),
    placeholderFigures,
    characters: canonicalQuestionPaperJson(content).length,
  };
}

/** The refusal for a document that failed {@link checkQuestionPaperDraft}: BAD_REQUEST listing the first findings. */
export function invalidPaperError(errors: QuestionPaperIssue[]) {
  const listed = errors.slice(0, MAX_LISTED_ERRORS).map(({ path, message }) => (path ? `${path}: ${message}` : message));
  const more = errors.length > MAX_LISTED_ERRORS ? ` (and ${errors.length - MAX_LISTED_ERRORS} more)` : '';
  return rpcError.badRequest(`The question paper is not valid${more}. ${listed.join('; ')}`);
}

const DRAFT_TOOL_NAME = /(^|[._])validateQuestionPaperDraft$/;
/** How many of a conversation's newest tool calls are searched for a draft. */
const DRAFT_SEARCH_DEPTH = 60;

/**
 * Finds the paper JSON a chat agent validated earlier in this conversation
 * (design E7): the newest `validateQuestionPaperDraft` tool call whose input
 * hashes to `draftId`. A draft is not a database row; the chat transcript is
 * its only home, which is why this reads the assistant's items, scoped to the
 * conversation, its school and its user. External clients have no
 * conversation and pass `content` instead.
 */
export async function findChatDraftContent(
  db: DatabaseExecutor,
  input: { conversationId: string; schoolId: string; userId: string; draftId: string },
): Promise<unknown> {
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
  const notFound = rpcError.badRequest('No draft with that draftId was validated in this conversation. Send the full content instead.');
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
    const content = (call.input as { content?: unknown } | null)?.content;
    const normalized = normalizeQuestionPaper(content);
    if (normalized.ok && questionPaperDraftId(normalized.value) === input.draftId) return content;
  }
  throw notFound;
}

export type SaveSource =
  | { kind: 'agent'; conversationId: string | null }
  | { kind: 'ai_job'; jobId: string; pageIds: string[] };

export type SavedVersion = {
  versionNo: number;
  paperId: string;
  totalMarks: number;
  planMaxMarks: number;
  warnings: QuestionPaperWarning[];
  hasPdf: true;
  /** True when this job had already saved its version and nothing was written. */
  replayed: boolean;
};

/** Another version landed between a job's render and its commit: render again with the new number. */
class VersionRaceError extends Error {}

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

const savedResult = (version: VersionRow, planMaxMarks: number): SavedVersion => ({
  versionNo: version.versionNo,
  paperId: version.paperId,
  totalMarks: version.totalMarks ?? 0,
  planMaxMarks: version.planMaxMarks ?? planMaxMarks,
  warnings: version.warnings,
  hasPdf: true,
  replayed: true,
});

/** A completed exam's papers are read-only; re-checked under the paper lock, where it cannot race a completion. */
async function assertExamNotEnded(db: DatabaseExecutor, key: PaperKey) {
  const [lifecycle] = await db.select({ status: examLifecycleTable.status }).from(examLifecycleTable).where(lifecycleWhere(key)).limit(1);
  if (lifecycle?.status === 'completed') {
    throw rpcError.badRequest('This examination has ended, so its question papers can no longer be changed.');
  }
}

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
    content: unknown;
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
  // Chat attachments may be figures only when an agent saves from a chat.
  const chatUserId = source.kind === 'agent' && source.conversationId ? input.userId : undefined;
  let checked = await checkQuestionPaperDraft(db, scope, input.content, { chatUserId });
  if (!checked.ok) throw invalidPaperError(checked.errors);
  if (attachmentFigureIds(checked.content).length > 0) {
    // Copy the attachments into the paper and store the version with its own
    // figure ids; the document is checked again as it will be stored.
    checked = await checkQuestionPaperDraft(db, scope, await convertAttachmentFigures(db, { scope, userId: input.userId, content: checked.content }));
    if (!checked.ok) throw invalidPaperError(checked.errors);
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
    content: checked.content,
  });
  const context = await buildQuestionPaperContext(db, scope, { content: checked.content, versionNo, totalMarks: checked.total });
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
      const locked = await lockOrCreatePaper(tx, scope.key, input.userId);
      await assertExamNotEnded(tx, scope.key);
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
        content: checked.content,
        contentSha256: questionPaperContentSha256(checked.content),
        schemaVersion: checked.content.schemaVersion,
        source: source.kind,
        sourceJobId: source.kind === 'ai_job' ? source.jobId : null,
        sourcePageIds: source.kind === 'ai_job' ? source.pageIds : null,
        sourceConversationId: source.kind === 'agent' ? source.conversationId : null,
        totalMarks: checked.total,
        planMaxMarks: scope.planMaxMarks,
        warnings: checked.warnings,
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
        totalMarks: checked.total,
        planMaxMarks: scope.planMaxMarks,
        warnings: checked.warnings,
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
  const body = await renderQuestionPaperBody(db, { schoolId: scope.key.schoolId, paperId: version.paperId, content: version.content });
  const context = await buildQuestionPaperContext(
    db,
    scope,
    { content: version.content, versionNo: version.versionNo, totalMarks: version.totalMarks },
    generatedAt,
  );
  return { html: renderQuestionPaperDocument({ template, context, body }), templateName: template.name };
}

/** A concurrent download stored a PDF for the same version first; this one is discarded. */
class PdfAlreadyStoredError extends Error {}

/**
 * A short-lived download URL for a version's PDF. The PDF stored when the
 * version was saved is served; if its artifact was deleted (the pointer is
 * then null) the version is printed again from its content and its pinned
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

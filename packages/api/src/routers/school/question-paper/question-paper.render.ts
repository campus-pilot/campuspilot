import type { DatabaseExecutor } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import { examQuestionPaperFigureTable } from '@campuspilot/db/schema/exam-question-paper';
import { QUESTION_PAPER_EXAMPLES } from '@campuspilot/question-paper/examples';
import { ORPCError } from '@orpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

import { rpcError } from '../../../errors';
import { SAMPLE_QUESTION_PAPER_CONTEXT } from '../document/document.catalog';
import {
  combineDocuments,
  isEmbeddableDocumentImage,
  renderDocument,
} from '../document/document.render';
import { readDocumentTemplate } from '../document/document.storage';
import { getSelectedDocumentTemplate, selectedDocumentTemplateTypes } from '../document/document.selected-template';
import { isAttachmentFigureId, loadAttachmentFigureAssets, type ChatFigures } from './question-paper.attachments';
import type { QuestionPaperContext } from './question-paper.context';
import { createMathRenderer, type MathRenderer } from './question-paper.math';
import {
  fragmentFigureIds,
  QUESTION_PAPER_DOCUMENT_MAX_BYTES,
  QUESTION_PAPER_FIGURES_MAX_BYTES,
  QUESTION_PAPER_MAX_LOGO_USES,
  QUESTION_PAPER_TEMPLATE_RENDER_MAX_CHARS,
  renderQuestionPaperBodyHtml,
  type FigureAssets,
  type RenderedBody,
} from './question-paper.body';
import { substituteQuestionPaperBody } from './question-paper.slot';
import { getObjectBytes } from './question-paper.storage';

export type { RenderedBody } from './question-paper.body';
export {
  QUESTION_PAPER_BODY_MAX_BYTES,
  QUESTION_PAPER_DOCUMENT_MAX_BYTES,
  QUESTION_PAPER_FIGURES_MAX_BYTES,
  QUESTION_PAPER_MAX_LOGO_USES,
  QUESTION_PAPER_TEMPLATE_RENDER_MAX_CHARS,
} from './question-paper.body';

/**
 * Loads the data URIs of the figures a paper uses (`figureIds`, as the
 * sanitiser found them in the fragment). Only a figure that belongs to this paper
 * of this school is loaded; another paper's or school's figure, or an unknown
 * id, is simply absent from the result (the body then prints a note and a
 * warning), so a paper can never print someone else's image by naming its id.
 * `paperId` is null for a draft of a paper that has no row yet, which can
 * then hold no figure.
 */
export async function loadFigureAssets(
  db: DatabaseExecutor,
  input: { schoolId: string; paperId: string | null; figureIds: readonly string[]; chat?: ChatFigures },
): Promise<FigureAssets> {
  const allIds = [...input.figureIds];
  if (allIds.length === 0) return new Map();
  // Chat attachments are only in drafts (a saved version holds its own figures).
  const attachmentIds = allIds.filter(isAttachmentFigureId);
  const storedIds = allIds.filter((id) => !isAttachmentFigureId(id));
  const rows =
    input.paperId === null
      ? []
      : await db
          .select()
          .from(examQuestionPaperFigureTable)
          .where(
            and(
              eq(examQuestionPaperFigureTable.schoolId, input.schoolId),
              eq(examQuestionPaperFigureTable.paperId, input.paperId),
              inArray(examQuestionPaperFigureTable.id, storedIds),
            ),
          );
  const known = new Map(rows.map((row) => [row.id, row]));
  // A stored figure id with no row (it belongs to another paper or school, or is gone) is not loaded: the body prints
  // "Figure unavailable" and a warning, so a stored version always renders and never shows another paper's image.
  // Authoring (`checkQuestionPaperDraft`) refuses such an id before anything is saved.
  const ids = storedIds.filter((id) => known.has(id));
  const assets = new Map<string, { dataUri: string }>(
    await loadAttachmentFigureAssets(db, { schoolId: input.schoolId, chat: input.chat, ids: attachmentIds }),
  );
  let total = [...assets.values()].reduce((sum, asset) => sum + asset.dataUri.length, 0);
  for (const id of ids) {
    const row = known.get(id)!;
    const bytes = await getObjectBytes(row.s3Key);
    const dataUri = `data:${row.contentType};base64,${bytes.toString('base64')}`;
    total += dataUri.length;
    if (total > QUESTION_PAPER_FIGURES_MAX_BYTES) {
      throw rpcError.badRequest('The figures of this paper are too large to print together. Use fewer or smaller images.');
    }
    assets.set(id, { dataUri });
  }
  return assets;
}

/** Renders the body fragment of a paper, loading its figures. See {@link renderQuestionPaperBodyHtml}. */
export async function renderQuestionPaperBody(
  db: DatabaseExecutor,
  input: { schoolId: string; paperId: string | null; html: string; math?: MathRenderer; chat?: ChatFigures },
): Promise<RenderedBody> {
  const figures = await loadFigureAssets(db, { ...input, figureIds: fragmentFigureIds(input.html) });
  return renderQuestionPaperBodyHtml(input.html, { figures, math: input.math ?? createMathRenderer() });
}

/**
 * Renders one template against a context under the template budget, with the
 * school logo as a placeholder that is replaced after sanitising at most
 * {@link QUESTION_PAPER_MAX_LOGO_USES} times (the notice technique: the logo
 * is the one large value in the context and an author can repeat any value
 * they are handed). Returns the sanitised, CSP-wrapped document with the
 * slot still in it.
 */
function renderTemplate(template: string, context: QuestionPaperContext): string {
  const logo = context.school.logoUrl;
  if (!logo) {
    return combineDocuments([renderDocument(template, context, { maxOutputChars: QUESTION_PAPER_TEMPLATE_RENDER_MAX_CHARS })], 'question_paper');
  }
  // Hex is inside the base64 alphabet, so the placeholder passes the sanitiser's image filter.
  const placeholder = `data:image/png;base64,${randomBytes(24).toString('hex')}`;
  const html = combineDocuments(
    [renderDocument(template, { ...context, school: { ...context.school, logoUrl: placeholder } }, { maxOutputChars: QUESTION_PAPER_TEMPLATE_RENDER_MAX_CHARS })],
    'question_paper',
  );
  const pieces = html.split(placeholder);
  if (pieces.length - 1 > QUESTION_PAPER_MAX_LOGO_USES) {
    throw rpcError.badRequest(`A question paper can show the school logo at most ${QUESTION_PAPER_MAX_LOGO_USES} times.`);
  }
  return pieces.join(isEmbeddableDocumentImage(logo) ? logo : '');
}

/**
 * The full document HTML of a paper: the school's template rendered and
 * sanitised like any other document, with the body (sanitised fragment plus
 * KaTeX and figures, see `question-paper.body.ts`) substituted into its single
 * slot afterwards. The template must place the slot exactly once
 * (BAD_REQUEST otherwise). The total must fit the document system's 25 MB.
 */
export function renderQuestionPaperDocument(input: {
  template: { content: string };
  context: QuestionPaperContext;
  body: RenderedBody;
}): string {
  const html = substituteQuestionPaperBody(renderTemplate(input.template.content, input.context), input.body.html);
  if (Buffer.byteLength(html, 'utf8') > QUESTION_PAPER_DOCUMENT_MAX_BYTES) {
    throw rpcError.badRequest('This document exceeds the 25 MB rendering limit. Use fewer or smaller figures.');
  }
  return html;
}

/** A pinned template revision of this school (never another school's or another type's). */
export async function readPinnedQuestionPaperTemplate(db: DatabaseExecutor, schoolId: string, revisionId: string) {
  const [row] = await db
    .select({ s3Key: artifactTable.s3Key, name: artifactTable.name })
    .from(artifactTable)
    .where(
      and(
        eq(artifactTable.id, revisionId),
        eq(artifactTable.schoolId, schoolId),
        eq(artifactTable.kind, 'template'),
        eq(artifactTable.documentType, 'question_paper'),
      ),
    )
    .limit(1);
  if (!row) throw new Error(`Question paper template revision ${revisionId} is missing.`);
  return { revisionId, name: row.name, content: await readDocumentTemplate(row.s3Key) };
}

/**
 * The school's selected question paper template revision, or null when it has
 * selected none (generation is then refused, there is no built-in design).
 */
export async function selectedQuestionPaperTemplate(db: DatabaseExecutor, schoolId: string) {
  try {
    const template = await getSelectedDocumentTemplate(db, { schoolId, documentType: 'question_paper' });
    return { revisionId: template.row.id, name: template.row.name, content: template.content };
  } catch (error) {
    if (error instanceof ORPCError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Whether the school has a selected question paper template, without reading
 * the template from storage (the detail screen polls this while a job runs
 * and only needs the fact).
 */
export async function hasSelectedQuestionPaperTemplate(db: DatabaseExecutor, schoolId: string): Promise<boolean> {
  return (await selectedDocumentTemplateTypes(db, schoolId, ['question_paper'])).has('question_paper');
}

let exampleBody: RenderedBody | undefined;
/**
 * The rendered English science example, used as the sample body
 * of template previews so an author sees a realistic page. It holds no
 * uploaded figure, so it needs no database.
 */
export function exampleQuestionPaperBody(): RenderedBody {
  if (exampleBody) return exampleBody;
  exampleBody = renderQuestionPaperBodyHtml(QUESTION_PAPER_EXAMPLES['english-science'], { figures: new Map(), math: createMathRenderer(10_000) });
  return exampleBody;
}

/**
 * The preview of a template: the synthetic school and paper context with the
 * example body in the slot. Also the way a template is checked when saved:
 * exactly one slot, the template budget, the logo limit, the 25 MB total.
 */
export function renderSampleQuestionPaperDocument(templateContent: string): string {
  return renderQuestionPaperDocument({
    template: { content: templateContent },
    context: SAMPLE_QUESTION_PAPER_CONTEXT,
    body: exampleQuestionPaperBody(),
  });
}

/**
 * Checks a school question paper template the way papers will render it
 * (design D1): a render against the sample context with the example body.
 * Invalid syntax, an unsupported helper, a slot that is not placed exactly
 * once, an oversized render or more than three uses of the logo is a
 * BAD_REQUEST. This is a courtesy to the author; every later render of every
 * paper runs under the same budgets.
 */
export function assertValidSchoolQuestionPaperTemplate(templateContent: string): void {
  renderSampleQuestionPaperDocument(templateContent);
}

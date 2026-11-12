import type { Database, DatabaseExecutor } from '@campuspilot/db';
import { assistantAttachmentTable } from '@campuspilot/db/schema/assistant';
import { examQuestionPaperFigureTable } from '@campuspilot/db/schema/exam-question-paper';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { rpcError } from '../../../errors';
import { normalizeFigureImage } from '../../../files/image-derivative';
import { findPaper } from './question-paper.records';
import { sanitizeQuestionPaperBody } from './question-paper.sanitize';
import type { PaperScope } from './question-paper.scope';
import { addQuestionPaperFigure } from './question-paper.service';
import { getObjectBytes } from './question-paper.storage';

/**
 * Chat attachments as figures (design B6/E7). In a chat the agent can put an
 * image the user attached (`asat_` id) into the fragment with
 * `<img data-figure-id="asat_...">`. Until a version is
 * saved the id stays as written: a draft is previewed straight from the
 * attachment. Saving copies each attachment into the paper's own figure rows
 * (`qpf_`, normalised, counted against the 30 figure cap) and rewrites the ids,
 * so a stored version never depends on a chat attachment, which is deleted with
 * its conversation.
 *
 * Who may use an attachment is its owner: the chat user. Only the in-app
 * assistant (and the draft preview of the person who owns the chat) pass a
 * `chatUserId`; an external client never has one, so `asat_` ids are refused
 * there.
 */

export const isAttachmentFigureId = (imageId: string) => imageId.startsWith('asat_');

/** The `asat_` ids a fragment uses, once each, as the sanitiser reads them. */
export function attachmentFigureIds(html: string): string[] {
  return sanitizeQuestionPaperBody(html).stats.figureIds.filter(isAttachmentFigureId);
}

type UsableRow = typeof assistantAttachmentTable.$inferSelect;

/** The user's sent attachments among `ids` in this school, by id. */
async function usableAttachments(
  db: DatabaseExecutor,
  input: { schoolId: string; chatUserId: string; ids: readonly string[] },
): Promise<Map<string, UsableRow>> {
  if (input.ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(assistantAttachmentTable)
    .where(
      and(
        inArray(assistantAttachmentTable.id, [...input.ids]),
        eq(assistantAttachmentTable.schoolId, input.schoolId),
        eq(assistantAttachmentTable.userId, input.chatUserId),
        isNotNull(assistantAttachmentTable.itemId),
      ),
    );
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * The object a figure is made from: the attachment's 1800 px model copy when
 * it has one (already upright and flattened, so a preview does not decode a
 * 40 megapixel original again), else the original.
 */
const figureSourceKey = (row: UsableRow) => row.modelS3Key ?? row.s3Key;

/** Why an `asat_` figure id cannot be used, or null when it can. */
export async function attachmentFigureProblems(
  db: DatabaseExecutor,
  input: { schoolId: string; chatUserId: string | undefined; ids: readonly string[] },
): Promise<Map<string, string>> {
  const problems = new Map<string, string>();
  if (input.ids.length === 0) return problems;
  if (!input.chatUserId) {
    for (const id of input.ids) problems.set(id, 'Figure images from chat attachments can only be used inside the in-app assistant chat. Use <figure data-placeholder="..."></figure>.');
    return problems;
  }
  const usable = await usableAttachments(db, { schoolId: input.schoolId, chatUserId: input.chatUserId, ids: input.ids });
  for (const id of input.ids) {
    const row = usable.get(id);
    if (!row) problems.set(id, 'This is not an image the user attached in a chat message.');
    else if (row.derivativeStatus !== 'ready') {
      problems.set(id, `${row.originalName} is in a format that cannot be printed (for example HEIC). Ask the user to attach a JPEG or PNG.`);
    }
  }
  return problems;
}

/** Print-ready data URIs of attachments, for previewing a draft. */
export async function loadAttachmentFigureAssets(
  db: DatabaseExecutor,
  input: { schoolId: string; chatUserId: string | undefined; ids: readonly string[] },
): Promise<Map<string, { dataUri: string }>> {
  const problems = await attachmentFigureProblems(db, input);
  if (problems.size > 0) throw rpcError.badRequest([...problems.values()][0]!);
  const rows = await usableAttachments(db, { schoolId: input.schoolId, chatUserId: input.chatUserId!, ids: input.ids });
  const assets = new Map<string, { dataUri: string }>();
  for (const id of input.ids) {
    const figure = await normalizeFigureImage(await getObjectBytes(figureSourceKey(rows.get(id)!)));
    assets.set(id, { dataUri: `data:${figure.contentType};base64,${figure.bytes.toString('base64')}` });
  }
  return assets;
}

/**
 * Copies every attachment the fragment uses into the paper as a figure (once
 * per attachment: a retried save reuses the figure it made) and returns the
 * fragment with the figure ids. The paper row is created if it does not exist
 * yet (a first version saved from chat). `html` is sanitiser output, where an
 * id appears only as a quoted `data-figure-id` value.
 */
export async function convertAttachmentFigures(
  db: Database,
  input: { scope: PaperScope; userId: string; html: string },
): Promise<string> {
  const ids = attachmentFigureIds(input.html);
  if (ids.length === 0) return input.html;
  const usable = await usableAttachments(db, { schoolId: input.scope.key.schoolId, chatUserId: input.userId, ids });
  const figureIdOf = new Map<string, string>();
  for (const id of ids) {
    const row = usable.get(id);
    if (!row) throw rpcError.badRequest('A figure uses an image that is not one of the chat attachments of this user.');
    const paper = await findPaper(db, input.scope.key);
    const [existing] = paper
      ? await db
          .select({ id: examQuestionPaperFigureTable.id })
          .from(examQuestionPaperFigureTable)
          .where(and(eq(examQuestionPaperFigureTable.paperId, paper.id), eq(examQuestionPaperFigureTable.sourceAttachmentId, id)))
          .limit(1)
      : [];
    if (existing) {
      figureIdOf.set(id, existing.id);
      continue;
    }
    const figure = await addQuestionPaperFigure(db, {
      scope: input.scope,
      userId: input.userId,
      bytes: await getObjectBytes(figureSourceKey(row)),
      sourceAttachmentId: id,
    });
    figureIdOf.set(id, figure.id);
  }
  // Only inside <img> and <figure> tags: a paragraph that merely quotes the attribute is text and stays as written.
  return input.html.replace(/<(?:img|figure)\b[^>]*>/g, (tag) =>
    tag.replace(/\sdata-figure-id="([^"]*)"/, (whole, id: string) => {
      const figureId = figureIdOf.get(id);
      return figureId ? ` data-figure-id="${figureId}"` : whole;
    }),
  );
}

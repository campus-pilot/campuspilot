import { getObjectBytes } from '@campuspilot/api/routers/school/question-paper/question-paper.storage';
import { examQuestionPaperPageTable, examQuestionPaperTable } from '@campuspilot/db/schema/exam-question-paper';
import { and, asc, eq } from 'drizzle-orm';

import type { AssistantExecutor } from './db';
import { db as defaultDb } from './db';
import { log } from './log';
import type { PaperPagePhoto } from './runtime/context';
import type { PaperKeyParts } from './store';

/** The paper whose photographed pages a conversation shared with it shows: an exam paper by its key, a standalone one by its id. */
export type PaperPagesTarget = { schoolId: string; paper: PaperKeyParts } | { schoolId: string; standalonePaperId: string };

/**
 * The photographed pages of a question paper for a chat request: each page's
 * model copy (the JPEG the generation job reads, at most 1800 px, already
 * turned upright), in page order. Pages whose copy is not made yet (a photo
 * still uploading or being processed) are left out; a copy that cannot be
 * read from storage is logged and left out, so one missing object never fails
 * the conversation.
 *
 * Lives outside `src/runtime` on purpose, like `attachments.ts`: the turn loop
 * gets the pages through an injected loader and reads no school table itself.
 * The conversation was shared with this paper by someone allowed to read its
 * papers, and everyone who may continue it may read them too
 * (`conversation-access.ts`), so the pages are no wider than the chat.
 */
export async function loadPaperPagePhotos(input: PaperPagesTarget, db: AssistantExecutor = defaultDb): Promise<PaperPagePhoto[]> {
  const { schoolId } = input;
  // A standalone paper (docs/personal-space.md) by its id; an exam paper by its key.
  const paperWhere =
    'standalonePaperId' in input
      ? and(eq(examQuestionPaperTable.id, input.standalonePaperId), eq(examQuestionPaperTable.kind, 'standalone'))
      : and(
          eq(examQuestionPaperTable.sessionId, input.paper.sessionId),
          eq(examQuestionPaperTable.examSlug, input.paper.examSlug),
          eq(examQuestionPaperTable.classId, input.paper.classId),
          eq(examQuestionPaperTable.subjectSlug, input.paper.subjectSlug),
          eq(examQuestionPaperTable.modeSlug, input.paper.modeSlug),
        );
  const rows = await db
    .select({ pageId: examQuestionPaperPageTable.id, position: examQuestionPaperPageTable.position, key: examQuestionPaperPageTable.modelS3Key, mimeType: examQuestionPaperPageTable.modelContentType })
    .from(examQuestionPaperPageTable)
    .innerJoin(examQuestionPaperTable, eq(examQuestionPaperTable.id, examQuestionPaperPageTable.paperId))
    .where(and(eq(examQuestionPaperTable.schoolId, schoolId), paperWhere))
    .orderBy(asc(examQuestionPaperPageTable.position));
  // Numbered as the teacher sees them: out of every page of the paper, also one whose copy is not ready.
  const total = rows.length;
  const loaded = await Promise.all(
    rows.map(async (row) => {
      if (row.key === null) return null;
      try {
        return { pageId: row.pageId, position: row.position, total, mimeType: row.mimeType ?? 'image/jpeg', bytes: await getObjectBytes(row.key) };
      } catch (error) {
        log.warn({ pageId: row.pageId, err: error instanceof Error ? error.message : String(error) }, 'assistant.paper-page.unreadable');
        return null;
      }
    }),
  );
  return loaded.filter((page) => page !== null);
}

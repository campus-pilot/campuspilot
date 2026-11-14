import { createHash } from 'node:crypto';

import type { Database, DatabaseExecutor } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import {
  examQuestionPaperFigureTable,
  examQuestionPaperTable,
  examQuestionPaperVersionTable,
} from '@campuspilot/db/schema/exam-question-paper';
import { sessionConfigSchema } from '@campuspilot/db/schema/jsonb/session-config';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { QUESTION_PAPER_LIMITS } from '@campuspilot/question-paper/limits';
import { ORPCError } from '@orpc/server';
import { and, desc, eq, gt, inArray, not, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { isAttachmentFigureId } from './question-paper.attachments';
import { fragmentFigureIds, replaceFigureIds } from './question-paper.body';
import type { PaperKey, listCopySourcesOutputSchema } from './question-paper.dto';
import { findPaper } from './question-paper.records';
import type { PaperScope } from './question-paper.scope';
import { storeQuestionPaperFigure, type PreparedFigure } from './question-paper.service';
import { getObjectBytes } from './question-paper.storage';

/**
 * Starting a paper from an earlier one (`listQuestionPaperCopySources`,
 * `copyQuestionPaperVersion`). The earlier paper is only read: a copy is a NEW
 * version of the target paper, saved through `saveQuestionPaperVersion` like
 * every other version, whose fragment is the source version's stored fragment
 * with the source's figures copied into the target.
 *
 * What may be copied: a saved version of another paper of the SAME school,
 * class and subject, from any session, exam and mode. A class is a school-level
 * row (`class` has no session column; exam plans and papers name it with
 * `class_id` in every session), so "the same class in an earlier session" is
 * the same `class_id`, an exact match and never a guess by name. The subject is
 * the same `subject_slug` of that class's configuration.
 */

/** `data.reason` of the BAD_REQUEST for a source in another school, class or subject than the target. */
export const COPY_SOURCE_MISMATCH_REASON = 'copy_source_mismatch';
/** `data.reason` of the BAD_REQUEST for a source that is the target paper itself. */
export const COPY_SOURCE_IS_TARGET_REASON = 'copy_source_is_target';
/** `data.reason` of the NOT_FOUND for a source paper or version that does not exist (or no longer does). */
export const COPY_SOURCE_NOT_FOUND_REASON = 'copy_source_not_found';
/** `data.reason` of the BAD_REQUEST for a figure of the source that cannot be copied; nothing is saved. */
export const COPY_FIGURE_UNAVAILABLE_REASON = 'copy_figure_unavailable';

/** The most sources `listQuestionPaperCopySources` returns (newest first). */
export const QUESTION_PAPER_COPY_SOURCES_LIMIT = 100;

/** The NOT_FOUND for a source paper or version that is not there. */
export const copySourceNotFoundError = (what: 'Question paper' | 'Question paper version') =>
  new ORPCError('NOT_FOUND', { message: `${what} to copy from was not found.`, data: { reason: COPY_SOURCE_NOT_FOUND_REASON } });

const copyFigureError = (message: string) =>
  new ORPCError('BAD_REQUEST', { message, data: { reason: COPY_FIGURE_UNAVAILABLE_REASON } });

/**
 * Refuses a source key the target may not copy from, from the keys alone (no
 * row is read): another school, another class or another subject is
 * `copy_source_mismatch`; the target's own key is `copy_source_is_target`
 * (saving the latest version again is not a copy).
 */
export function assertCopySourceAllowed(target: PaperKey, source: PaperKey): void {
  if (source.schoolId !== target.schoolId || source.classId !== target.classId || source.subjectSlug !== target.subjectSlug) {
    throw new ORPCError('BAD_REQUEST', {
      message: 'A paper can only be started from an earlier paper of the same school, class and subject.',
      data: { reason: COPY_SOURCE_MISMATCH_REASON },
    });
  }
  if (source.sessionId === target.sessionId && source.examSlug === target.examSlug && source.modeSlug === target.modeSlug) {
    throw new ORPCError('BAD_REQUEST', {
      message: 'Choose an earlier paper to copy from; this is the paper itself.',
      data: { reason: COPY_SOURCE_IS_TARGET_REASON },
    });
  }
}

/** "2025–26", the way session labels are written elsewhere (Cadet Portal). */
const sessionLabelOf = (start: number, end: number) => `${start}–${String(end).slice(-2)}`;

/**
 * `listQuestionPaperCopySources`: the saved papers the target may be started
 * from (the rule in this file's header), each with its latest version, newest
 * saved first, at most {@link QUESTION_PAPER_COPY_SOURCES_LIMIT}. A paper
 * without a version is not listed (there is nothing to copy), nor is the target
 * itself. The latest version is the row numbered `latest_version_no`, the same
 * join `listQuestionPapers` uses. Names are read from the configuration as it
 * is today (an exam removed from its session, or a mode the class no longer
 * names, shows its slug); the maximum marks are the version's saved snapshot.
 */
export async function listQuestionPaperCopySources(
  db: DatabaseExecutor,
  scope: PaperScope,
): Promise<z.infer<typeof listCopySourcesOutputSchema>> {
  const { key } = scope;
  const [rows, [schoolClass]] = await Promise.all([
    db
      .select({
        sessionId: examQuestionPaperTable.sessionId,
        examSlug: examQuestionPaperTable.examSlug,
        modeSlug: examQuestionPaperTable.modeSlug,
        latestVersionNo: examQuestionPaperTable.latestVersionNo,
        savedAt: examQuestionPaperVersionTable.createdAt,
        planMaxMarks: examQuestionPaperVersionTable.planMaxMarks,
        sessionStartYear: schoolSessionTable.sessionStartYear,
        sessionEndYear: schoolSessionTable.sessionEndYear,
        sessionActive: schoolSessionTable.isActive,
        sessionConfig: schoolSessionTable.sessionConfig,
      })
      .from(examQuestionPaperTable)
      .innerJoin(
        examQuestionPaperVersionTable,
        and(
          eq(examQuestionPaperVersionTable.paperId, examQuestionPaperTable.id),
          eq(examQuestionPaperVersionTable.versionNo, examQuestionPaperTable.latestVersionNo),
        ),
      )
      .innerJoin(
        schoolSessionTable,
        and(eq(schoolSessionTable.id, examQuestionPaperTable.sessionId), eq(schoolSessionTable.schoolId, examQuestionPaperTable.schoolId)),
      )
      .where(
        and(
          eq(examQuestionPaperTable.schoolId, key.schoolId),
          eq(examQuestionPaperTable.classId, key.classId),
          eq(examQuestionPaperTable.subjectSlug, key.subjectSlug),
          gt(examQuestionPaperTable.latestVersionNo, 0),
          not(
            and(
              eq(examQuestionPaperTable.sessionId, key.sessionId),
              eq(examQuestionPaperTable.examSlug, key.examSlug),
              eq(examQuestionPaperTable.modeSlug, key.modeSlug),
            )!,
          ),
        ),
      )
      .orderBy(desc(examQuestionPaperVersionTable.createdAt), desc(examQuestionPaperVersionTable.id))
      .limit(QUESTION_PAPER_COPY_SOURCES_LIMIT),
    db
      .select({ config: classTable.config })
      .from(classTable)
      .where(and(eq(classTable.id, key.classId), eq(classTable.schoolId, key.schoolId)))
      .limit(1),
  ]);
  const modes = schoolClass?.config?.subjects?.[key.subjectSlug]?.examModes;
  return {
    sources: rows.map((row) => {
      const exams = sessionConfigSchema.parse(row.sessionConfig ?? {}).examConfig;
      return {
        key: { schoolId: key.schoolId, sessionId: row.sessionId, examSlug: row.examSlug, classId: key.classId, subjectSlug: key.subjectSlug, modeSlug: row.modeSlug },
        sessionLabel: sessionLabelOf(row.sessionStartYear, row.sessionEndYear),
        sessionActive: row.sessionActive,
        examName: Object.hasOwn(exams, row.examSlug) ? exams[row.examSlug]!.name : row.examSlug,
        modeName: (modes && Object.hasOwn(modes, row.modeSlug) ? modes[row.modeSlug]?.name : undefined) ?? row.modeSlug,
        latestVersionNo: row.latestVersionNo,
        savedAt: row.savedAt,
        planMaxMarks: row.planMaxMarks,
      };
    }),
  };
}

/** The figure ids of a stored fragment that name figures of a paper (`qpf_`), not chat attachments. */
export const storedFigureIds = (html: string) => fragmentFigureIds(html).filter((id) => !isAttachmentFigureId(id));

/**
 * Copies the figures a source version prints into the target paper and returns
 * the fragment with the target's figure ids. `html` is sanitiser output.
 *
 * Every id must name a figure row of the SOURCE paper (same school); a fragment
 * that prints any other id (a figure that is gone, or never was the source's)
 * is refused, because the copy would print "Figure unavailable". Each object is
 * read and checked against the row's stored size and sha256 BEFORE anything is
 * written, and the target's figure cap is checked for the whole set, so a
 * figure that cannot be copied refuses the copy with nothing written. The bytes
 * are stored as they are (the source row was normalised when it was made;
 * normalising again would re-encode a JPEG for nothing), under the target
 * school's `exam-question-papers/figures/` keys, as new rows owned by the target
 * paper with `source_figure_id`. A figure this target already copied from the
 * same source figure is reused. Placeholders have no id and stay placeholders.
 *
 * Should the version itself then be refused (a stale `expectedVersionNo` that
 * landed in between, the exam completing), the figures copied here stay on the
 * target paper unused and go with it, exactly as copied chat attachments do;
 * they are never deleted here, because a concurrent copy may already reuse them.
 */
export async function copySourceFigures(
  db: Database,
  input: { scope: PaperScope; userId: string; html: string; sourcePaperId: string },
): Promise<string> {
  const ids = storedFigureIds(input.html);
  if (ids.length === 0) return input.html;
  const { schoolId } = input.scope.key;
  const sourceRows = await db
    .select()
    .from(examQuestionPaperFigureTable)
    .where(
      and(
        eq(examQuestionPaperFigureTable.paperId, input.sourcePaperId),
        eq(examQuestionPaperFigureTable.schoolId, schoolId),
        inArray(examQuestionPaperFigureTable.id, ids),
      ),
    );
  const sourceOf = new Map(sourceRows.map((row) => [row.id, row]));
  const target = await findPaper(db, input.scope.key);
  const reused = new Map(
    target
      ? (
          await db
            .select({ id: examQuestionPaperFigureTable.id, sourceFigureId: examQuestionPaperFigureTable.sourceFigureId })
            .from(examQuestionPaperFigureTable)
            .where(and(eq(examQuestionPaperFigureTable.paperId, target.id), inArray(examQuestionPaperFigureTable.sourceFigureId, ids)))
        ).map((row) => [row.sourceFigureId!, row.id])
      : [],
  );

  // Read and verify every figure still to be copied before writing any.
  const pending: Array<{ sourceFigureId: string; figure: PreparedFigure }> = [];
  for (const [index, id] of ids.entries()) {
    if (reused.has(id)) continue;
    const row = sourceOf.get(id);
    if (!row) throw copyFigureError(`Figure ${index + 1} of the paper being copied is no longer stored with it, so the copy would print a missing image. Nothing was saved.`);
    const bytes = await getObjectBytes(row.s3Key).catch(() => null);
    if (!bytes || bytes.byteLength !== row.byteSize || createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
      throw copyFigureError(`The image of figure ${index + 1} of the paper being copied could not be read. Nothing was saved.`);
    }
    pending.push({
      sourceFigureId: id,
      figure: { bytes, contentType: row.contentType, extension: row.contentType === 'image/png' ? 'png' : 'jpg', width: row.width, height: row.height },
    });
  }
  if (pending.length > 0 && target) {
    const [count] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(examQuestionPaperFigureTable)
      .where(eq(examQuestionPaperFigureTable.paperId, target.id));
    if (count!.count + pending.length > QUESTION_PAPER_LIMITS.figures) {
      throw copyFigureError(`A paper can have at most ${QUESTION_PAPER_LIMITS.figures} figure images, and this copy would add ${pending.length} more. Nothing was saved.`);
    }
  }

  const figureIdOf = new Map(reused);
  for (const { sourceFigureId, figure } of pending) {
    const row = await storeQuestionPaperFigure(db, {
      scope: input.scope,
      userId: input.userId,
      figure,
      provenance: { sourceAttachmentId: null, sourceFigureId },
    });
    figureIdOf.set(sourceFigureId, row.id);
  }
  return replaceFigureIds(input.html, figureIdOf);
}

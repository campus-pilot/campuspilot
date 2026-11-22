'use client';

import { CLASS_ACTIONS, SCHOOL_ACTIONS, type PermissionCheck } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { detailOutputSchema } from '@campuspilot/api/routers/school/question-paper/question-paper.dto';
import type { standalonePaperDetailOutputSchema, StandalonePaperDetailsDto } from '@campuspilot/api/routers/school/standalone-paper/standalone-paper.dto';
import type { AssistantMessageSeed } from '@campuspilot/assistant-contract/attachments';
import type { z } from 'zod';

import { client, orpc } from '@/lib/orpc';
import type { QuestionPaperScope } from './question-paper-model';

/**
 * The paper a question paper screen works on (docs/personal-space.md): an exam
 * paper by its plan's key (`QuestionPaperScope`), or a standalone paper of a
 * personal space by its id. The two are told apart by their own fact, the
 * `paperId` a standalone target names, never by which other fields are set.
 *
 * Both kinds share the studio (photos, generation, chat, versions, preview,
 * download); this module is the one place that knows which procedure, upload
 * route and permission serves each. A procedure input is the target spread
 * with the call's own fields, as the API takes it for either kind.
 */
export type StandalonePaperTarget = { schoolId: string; paperId: string };
export type PaperTarget = QuestionPaperScope | StandalonePaperTarget;

export const isStandaloneTarget = (target: PaperTarget): target is StandalonePaperTarget =>
  typeof (target as { paperId?: unknown }).paperId === 'string';

/** The same target as plain values (for a query key): the paper's identity and nothing else. */
export const targetKeyOf = (target: PaperTarget): readonly string[] =>
  isStandaloneTarget(target)
    ? ['standalone', target.schoolId, target.paperId]
    : ['exam', target.schoolId, target.sessionId, target.examSlug, target.classId, target.subjectSlug, target.modeSlug];

type ExamDetail = z.infer<typeof detailOutputSchema>;
type StandaloneDetail = z.infer<typeof standalonePaperDetailOutputSchema>;

/**
 * The facts the studio reads about a paper, for either kind. An exam paper's
 * detail is one as it is. A standalone paper has no exam that could end and
 * no session that could stop being active, so its lock facts are
 * `examCompleted: false` and `sessionActive: true` (nothing locks it but the
 * school's own read-only state, which the server refuses with its own
 * message); it has no plan, so `planMaxMarks` is null; and it needs no
 * template (`templateConfigured`). `details` is the standalone paper's own
 * details; null for an exam paper, whose names come from its plan.
 */
export type StudioPaperFacts = {
  paperId: string | null;
  pageCount: number;
  pageRevision: number;
  latestVersionNo: number;
  examCompleted: boolean;
  sessionActive: boolean;
  planMaxMarks: number | null;
  details: StandalonePaperDetailsDto | null;
};
export type StudioDetail = Omit<ExamDetail, 'paper'> & { paper: StudioPaperFacts };

/** An exam paper's detail as the studio reads it. */
export const studioDetailOfExam = (detail: ExamDetail): StudioDetail => ({ ...detail, paper: { ...detail.paper, details: null } });

/** A standalone paper's detail as the studio reads it (see {@link StudioPaperFacts}). */
export const studioDetailOfStandalone = (detail: StandaloneDetail): StudioDetail => ({
  ...detail,
  templateConfigured: true,
  paper: {
    paperId: detail.paper.paperId,
    pageCount: detail.paper.pageCount,
    pageRevision: detail.paper.pageRevision,
    latestVersionNo: detail.paper.latestVersionNo,
    examCompleted: false,
    sessionActive: true,
    planMaxMarks: null,
    details: detail.paper.details,
  },
});

/** The query key of a paper's detail read, for a cache patch or an invalidation. */
export function paperDetailQueryKey(target: PaperTarget) {
  return isStandaloneTarget(target)
    ? orpc.school.getStandalonePaperDetail.queryKey({ input: target })
    : orpc.school.getQuestionPaperDetail.queryKey({ input: target });
}

/** The query options of a paper's detail read, as the studio reads it (`select` keeps the cache in the server's shape). */
export function paperDetailQueryOptions(target: PaperTarget, refetchInterval?: (data: unknown) => number | false) {
  return {
    queryKey: paperDetailQueryKey(target),
    queryFn: async (): Promise<ExamDetail | StandaloneDetail> =>
      isStandaloneTarget(target) ? client.school.getStandalonePaperDetail(target) : client.school.getQuestionPaperDetail(target),
    select: (data: ExamDetail | StandaloneDetail): StudioDetail =>
      isStandaloneTarget(target) ? studioDetailOfStandalone(data as StandaloneDetail) : studioDetailOfExam(data as ExamDetail),
    ...(refetchInterval ? { refetchInterval: (query: { state: { data: unknown } }) => refetchInterval(query.state.data) } : {}),
  };
}

/** The school permission a personal space's papers need: to read them (`read`) or to change them and create new ones (`manage`). */
export function standalonePaperPermission(schoolId: string, kind: 'read' | 'manage'): PermissionCheck {
  return {
    action: kind === 'read' ? SCHOOL_ACTIONS.READ_STANDALONE_PAPERS : SCHOOL_ACTIONS.MANAGE_STANDALONE_PAPERS,
    resource: { kind: 'school', schoolId },
  };
}

/** The permission the paper's reads (`read`) or changes (`manage`) need, exactly as its procedures check it. */
export function paperPermission(target: PaperTarget, kind: 'read' | 'manage'): PermissionCheck {
  if (isStandaloneTarget(target)) return standalonePaperPermission(target.schoolId, kind);
  return {
    action: kind === 'read' ? CLASS_ACTIONS.READ_EXAM_QUESTION_PAPERS : CLASS_ACTIONS.MANAGE_EXAM_QUESTION_PAPERS,
    resource: { kind: 'class', schoolId: target.schoolId, classId: target.classId },
  };
}

/** The paper as a conversation's seed: an exam paper's natural key, a standalone paper's id; nothing else. */
export const paperSeedOf = (target: PaperTarget): AssistantMessageSeed =>
  isStandaloneTarget(target)
    ? { kind: 'standalone_question_paper', paperId: target.paperId }
    : {
        kind: 'question_paper',
        sessionId: target.sessionId,
        examSlug: target.examSlug,
        classId: target.classId,
        subjectSlug: target.subjectSlug,
        modeSlug: target.modeSlug,
      };

/**
 * "Mathematics, Class 5, Half Yearly Examination": how a standalone paper is
 * named in the save request and in subtitles, from the details its latest
 * version states; "this question paper" when it states none.
 */
export function standalonePaperLabelOf(details: StandalonePaperDetailsDto | null): string {
  const parts = details ? [details.subjectName, details.className, details.examName].filter((part): part is string => part !== null) : [];
  return parts.length > 0 ? parts.join(', ') : 'this question paper';
}

/** The page changes and PDF requests of a paper, sent to the procedures of its kind. */
export const paperCalls = {
  reservePages: (target: PaperTarget, fileNames: string[]) =>
    isStandaloneTarget(target) ? client.school.reserveStandalonePaperPages({ ...target, fileNames }) : client.school.reserveQuestionPaperPages({ ...target, fileNames }),
  releasePage: (target: PaperTarget, pageId: string) =>
    isStandaloneTarget(target) ? client.school.releaseStandalonePaperPage({ ...target, pageId }) : client.school.releaseQuestionPaperPage({ ...target, pageId }),
  deletePage: (target: PaperTarget, input: { pageId: string; expectedPageRevision: number }) =>
    isStandaloneTarget(target) ? client.school.deleteStandalonePaperPage({ ...target, ...input }) : client.school.deleteQuestionPaperPage({ ...target, ...input }),
  reorderPages: (target: PaperTarget, input: { pageIds: string[]; expectedPageRevision: number }) =>
    isStandaloneTarget(target) ? client.school.reorderStandalonePaperPages({ ...target, ...input }) : client.school.reorderQuestionPaperPages({ ...target, ...input }),
  rotatePage: (target: PaperTarget, input: { pageId: string; rotation: 0 | 90 | 180 | 270; expectedPageRevision: number }) =>
    isStandaloneTarget(target) ? client.school.rotateStandalonePaperPage({ ...target, ...input }) : client.school.rotateQuestionPaperPage({ ...target, ...input }),
  startGeneration: (target: PaperTarget, input: { expectedPageRevision: number; instructions?: string }) =>
    isStandaloneTarget(target)
      ? client.school.startStandalonePaperGeneration({ ...target, ...input })
      : client.school.startQuestionPaperGeneration({ ...target, ...input }),
  deletePaper: (target: PaperTarget) => (isStandaloneTarget(target) ? client.school.deleteStandalonePaper(target) : client.school.deleteQuestionPaper(target)),
  download: (target: PaperTarget, versionNo: number) =>
    isStandaloneTarget(target)
      ? client.school.getStandalonePaperDownload({ ...target, versionNo })
      : client.school.getQuestionPaperDownload({ ...target, versionNo }),
  preview: (target: PaperTarget, versionNo: number) =>
    isStandaloneTarget(target)
      ? client.school.getStandalonePaperPreview({ ...target, versionNo })
      : client.school.getQuestionPaperPreview({ ...target, versionNo }),
};

/** The query options of a saved version's HTML preview (its notices and placeholders), for either kind. */
export const paperPreviewQueryOptions = (target: PaperTarget, versionNo: number) => ({
  queryKey: ['question-paper', 'preview', ...targetKeyOf(target), versionNo] as const,
  queryFn: () => paperCalls.preview(target, versionNo),
});

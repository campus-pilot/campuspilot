import type { SchoolQuestionPaperListItemDto } from '@campuspilot/api/routers/school/question-paper/question-paper.school-list.dto';

import { questionPaperWorkspaceHref } from '@/components/exam/exam-model';
import { schoolSessionHref } from '@/components/school-route';

/**
 * A school's Question papers page and its quick papers (docs/question-papers.md
 * "The Question papers page"). The page is the session's, like Notices and
 * Documents: the session switcher changes which exam papers it lists. Quick
 * papers belong to no session, so every session's page lists them and a quick
 * paper's screen opens under whichever session the person is in.
 */
export type QuestionPapersScope = { schoolId: string; sessionId: string };

/** The Question papers page of a session. */
export const schoolQuestionPapersHref = ({ schoolId, sessionId }: QuestionPapersScope) => schoolSessionHref(schoolId, sessionId, '/question-papers');

/** One quick paper's screen (a standalone paper of the school), below the page of the session the person is in. */
export const quickPaperHref = (scope: QuestionPapersScope, paperId: string) => `${schoolQuestionPapersHref(scope)}/${encodeURIComponent(paperId)}`;

/** Where a listed paper opens: a quick paper's own screen, or an exam paper's screen in its examination. */
export function schoolQuestionPaperHref(scope: QuestionPapersScope, paper: Pick<SchoolQuestionPaperListItemDto, 'paperId' | 'examKey'>): string {
  if (!paper.examKey) return quickPaperHref(scope, paper.paperId);
  return questionPaperWorkspaceHref({ ...scope, ...paper.examKey });
}

/** What each paper type is called on the page: never "standalone", the code's word. */
export const QUESTION_PAPER_TYPE_LABELS = { quick: 'Quick paper', exam: 'Exam paper' } as const;

/** The filter's options, in the order the filter offers them. */
export const QUESTION_PAPER_TYPE_OPTIONS = [
  { value: 'quick', label: 'Quick papers' },
  { value: 'exam', label: 'Exam papers' },
] as const;

export const QUESTION_PAPER_STATUS_OPTIONS = [
  { value: 'generated', label: 'Generated' },
  { value: 'not_generated', label: 'Not generated yet' },
] as const;

/** The filters the page opens with: its own papers made here first (quick papers), the type filter shown as set. */
export const DEFAULT_QUESTION_PAPER_FILTERS = { type: 'quick' } as const;

/**
 * The row's title and the facts under it: the subject (an exam paper's mode
 * beside it), then the class and examination. A quick paper that states no
 * subject yet is an untitled paper.
 */
export function questionPaperRowNames(paper: Pick<SchoolQuestionPaperListItemDto, 'subjectName' | 'modeName' | 'className' | 'examName'>) {
  const subject = paper.subjectName ?? 'Untitled paper';
  return {
    title: paper.modeName ? `${subject} · ${paper.modeName}` : subject,
    facts: [paper.className, paper.examName].filter((value): value is string => Boolean(value)),
  };
}

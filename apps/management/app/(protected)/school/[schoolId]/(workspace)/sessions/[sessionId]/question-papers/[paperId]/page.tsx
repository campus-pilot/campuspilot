import { quickPaperHref, schoolQuestionPapersHref } from '@/components/question-paper/school-question-papers-model';
import { StandalonePaperWorkspace } from '@/components/question-paper/standalone-paper-workspace';

/** One quick paper of a school (docs/question-papers.md "Quick papers in a school"). */
export default async function QuickPaperPage({ params }: { params: Promise<{ schoolId: string; sessionId: string; paperId: string }> }) {
  const { schoolId, sessionId, paperId } = await params;
  const scope = { schoolId, sessionId };
  // Keyed by the paper: another paper is a new screen, with its own upload queue and chat.
  return (
    <StandalonePaperWorkspace
      key={`${schoolId}/${paperId}`}
      target={{ schoolId, paperId }}
      place={{ paperHref: quickPaperHref(scope, paperId), listHref: schoolQuestionPapersHref(scope) }}
    />
  );
}

import { personalPaperHref, personalPapersHref } from '@/components/personal-space/personal-space-model';
import { StandalonePaperWorkspace } from '@/components/question-paper/standalone-paper-workspace';

/** One standalone question paper of a personal space (docs/personal-space.md). */
export default async function PersonalPaperPage({ params }: { params: Promise<{ schoolId: string; paperId: string }> }) {
  const target = await params;
  // Keyed by the paper: another paper is a new screen, with its own upload queue and chat.
  return (
    <StandalonePaperWorkspace
      key={`${target.schoolId}/${target.paperId}`}
      target={{ schoolId: target.schoolId, paperId: target.paperId }}
      place={{ paperHref: personalPaperHref(target.schoolId, target.paperId), listHref: personalPapersHref(target.schoolId) }}
    />
  );
}

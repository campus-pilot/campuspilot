import { SchoolQuestionPaperList } from '@/components/question-paper/school-question-paper-list';

/** A session's question papers: its quick papers and exam papers (docs/question-papers.md "The Question papers page"). */
export default async function QuestionPapersPage({ params }: { params: Promise<{ schoolId: string; sessionId: string }> }) {
  const { schoolId, sessionId } = await params;
  return <SchoolQuestionPaperList scope={{ schoolId, sessionId }} />;
}

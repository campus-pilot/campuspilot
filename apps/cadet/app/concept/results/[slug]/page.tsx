import { notFound } from 'next/navigation';
import { AwaitingReleaseScreen, ResultDetailScreen } from '@/components/concept/results-screen';
import { exams } from '@/components/concept/mock-data';

/** Only a result the school has released shows marks; any other state renders the waiting screen. */
export default async function ConceptResultPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const exam = exams.find((candidate) => candidate.slug === slug);
  if (!exam || exam.status === 'upcoming') notFound();
  if (exam.releasedToCadetAt === null || exam.subjects.length === 0) return <AwaitingReleaseScreen exam={exam} />;
  return <ResultDetailScreen exam={exam} />;
}

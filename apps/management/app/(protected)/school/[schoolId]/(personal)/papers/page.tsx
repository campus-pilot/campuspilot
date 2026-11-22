import { StandalonePaperList } from '@/components/personal-space/standalone-paper-list';

/** A personal space's question papers (docs/personal-space.md). */
export default async function PersonalPapersPage({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  return <StandalonePaperList schoolId={schoolId} />;
}

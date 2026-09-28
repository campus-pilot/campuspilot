import { SchoolSessionEntryRedirect } from '@/components/school-selection';

export default async function SchoolEntryPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  return <SchoolSessionEntryRedirect schoolId={schoolId} />;
}

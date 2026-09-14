import { StaffTable } from '@/components/staff-table';

export default async function StaffPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  return <StaffTable schoolId={schoolId} />;
}

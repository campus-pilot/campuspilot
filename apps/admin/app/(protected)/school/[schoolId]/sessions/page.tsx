import { SessionsTable } from '@/components/session/sessions-table';

export default async function SessionsPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  return <SessionsTable schoolId={schoolId} />;
}


import { DocumentWorkspace } from '@/components/documents/document-workspace';
import { z } from 'zod';
const workspaceDocumentTypeSchema = z.enum([
  'report_card',
  'id_card',
  'admit_card',
  'timetable',
  'bill',
  'receipt',
]);
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ schoolId: string; sessionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [scope, query] = await Promise.all([params, searchParams]);
  const type = workspaceDocumentTypeSchema.safeParse(query.type);
  const text = (key: string) =>
    typeof query[key] === 'string' ? (query[key] as string) : undefined;
  const initial = {
    documentType: type.success ? type.data : undefined,
    classId: text('classId'),
    examSlug: text('examSlug'),
    studentId: text('studentId'),
  };
  return (
    <DocumentWorkspace
      key={JSON.stringify({ scope, initial })}
      scope={scope}
      initial={initial}
    />
  );
}

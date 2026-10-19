import { DocumentTemplateMarketplace } from '@/components/documents/document-template-marketplace';
import { documentTypeSchema } from '@campuspilot/api/routers/school/document/document.dto';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ schoolId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ schoolId }, query] = await Promise.all([params, searchParams]);
  const type = documentTypeSchema.safeParse(query.type);
  return (
    <DocumentTemplateMarketplace
      schoolId={schoolId}
      initialType={type.success ? type.data : undefined}
    />
  );
}

import { redirect } from 'next/navigation';
import { documentTypeSchema } from '@campuspilot/api/routers/school/document/document.dto';
const academicTypes = new Set(['report_card', 'id_card', 'admit_card', 'timetable']);

const settingsSlugs = {
  report_card: 'examination',
  id_card: 'id-card',
  admit_card: 'admit-card',
  timetable: 'timetable',
} as const;

/** Preserve old bookmarked URLs while keeping template configuration out of the
 * operational Documents workspace.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ schoolId: string; sessionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [scope, query] = await Promise.all([params, searchParams]);
  const type = documentTypeSchema.safeParse(query.type);
  const documentType = type.success && academicTypes.has(type.data) ? type.data as keyof typeof settingsSlugs : 'report_card';
  redirect(
    `/school/${encodeURIComponent(scope.schoolId)}/settings/templates/${settingsSlugs[documentType]}`,
  );
}

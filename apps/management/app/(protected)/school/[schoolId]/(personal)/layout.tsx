import type { ReactNode } from 'react';
import { PersonalSpaceShell } from '@/components/personal-space/personal-space-shell';

/**
 * The pages of a personal space (docs/personal-space.md), outside the school
 * workspace: no sidebar, the personal space's own bar. The shell shows them
 * only for a school of kind `personal`; any other school's address here is
 * not found.
 */
export default async function PersonalSpaceLayout({ children, params }: { children: ReactNode; params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  return (
    <PersonalSpaceShell schoolId={schoolId} pageTitle="Question papers">
      {children}
    </PersonalSpaceShell>
  );
}

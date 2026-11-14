import type { ReactNode } from 'react';

import { AssistantWorkspaceFromAddress } from '@/components/assistant/assistant-workspace';

/**
 * The assistant page and its conversations are one screen, rendered here
 * rather than by the pages: Next keeps a layout mounted while the path below
 * it changes, so moving between `/assistant` and `/assistant/<id>` (as the
 * first message of a new conversation does) changes the address without
 * replacing the page. The pages render nothing of their own.
 */
export default async function AssistantLayout({
  params,
  children,
}: {
  params: Promise<{ schoolId: string }>;
  children: ReactNode;
}) {
  const { schoolId } = await params;
  return (
    <>
      <AssistantWorkspaceFromAddress schoolId={schoolId} />
      {children}
    </>
  );
}

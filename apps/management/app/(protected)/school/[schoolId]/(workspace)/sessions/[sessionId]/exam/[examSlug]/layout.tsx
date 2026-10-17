import type { ReactNode } from 'react';
import { ExamWorkspace } from '@/components/exam/exam-workspace';
export default async function Layout({ params, children }: { params: Promise<{ schoolId: string; sessionId: string; examSlug: string }>; children: ReactNode }) {
  const scope = await params;
  return <ExamWorkspace scope={scope}>{children}</ExamWorkspace>;
}

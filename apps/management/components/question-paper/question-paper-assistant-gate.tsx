'use client';

import type { ReactNode } from 'react';
import { useAssistantGate } from '@/components/assistant/assistant-access';
import { LoadingExam, Notice } from '@/components/exam/exam-common';

/**
 * Question paper screens belong to the AI assistant feature (D26, D42): the
 * tab is hidden when the school lacks the feature or the user's role may not
 * use it, and this covers a typed or bookmarked address. While either fact
 * loads nothing is guessed; when it is closed the person reads why instead of
 * a raw server error.
 */
export function QuestionPaperAssistantGate({ schoolId, children }: { schoolId: string; children: ReactNode }) {
  const gate = useAssistantGate(schoolId);
  if (gate === 'pending') return <LoadingExam />;
  if (gate === 'denied') {
    return <Notice>Question papers need the AI assistant, which is not available for this school or for your role.</Notice>;
  }
  return children;
}

'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AppShellAlert } from '@campuspilot/components/app-shell';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
import { schoolHref } from '@/components/school-route';

const MESSAGE = 'Choose a question paper template before generating papers.';

/** Where a school picks its question paper design (decision D17: no default design is shipped). */
export const questionPaperTemplateHref = (schoolId: string) =>
  `${schoolHref(schoolId, '/marketplace/templates')}?type=question_paper`;

/**
 * The persistent warning shown while the school has no question paper
 * template. A viewer sees it; only someone who may manage templates also gets
 * the action, which closes the alert list first (ui-patterns). Render it only
 * while the condition holds: unmounting removes the registration.
 */
export function QuestionPaperTemplateAlert({ schoolId }: { schoolId: string }) {
  const router = useRouter();
  const choose = useCallback(
    (closeDialog: () => void) => {
      closeDialog();
      router.push(questionPaperTemplateHref(schoolId));
    },
    [router, schoolId],
  );
  const alert = { slug: `school/${schoolId}/question-paper-template-missing`, message: MESSAGE, type: 'warning' as const };
  return (
    <RequirePermissions
      permissions={{ action: SCHOOL_ACTIONS.MANAGE_DOCUMENT_TEMPLATES, resource: { kind: 'school', schoolId } }}
      fallback={<AppShellAlert {...alert} />}
    >
      <AppShellAlert {...alert} actionLabel="Choose template" onAction={choose} />
    </RequirePermissions>
  );
}

/**
 * The alert for screens that do not load a paper (the class grid): reads the
 * selected template itself. Needs the template read permission; without it
 * the warning is simply not shown (the workspace still blocks Generate).
 */
export function QuestionPaperTemplateAlertForSchool({ schoolId }: { schoolId: string }) {
  return (
    <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES, resource: { kind: 'school', schoolId } }}>
      <MissingTemplateCheck schoolId={schoolId} />
    </RequirePermissions>
  );
}

function MissingTemplateCheck({ schoolId }: { schoolId: string }) {
  const template = useQuery(
    orpc.school.getActiveDocumentTemplate.queryOptions({ input: { schoolId, documentType: 'question_paper' } }),
  );
  // Nothing while loading or when the read failed: only a confirmed absence warns.
  if (template.isPending || template.isError || template.data) return null;
  return <QuestionPaperTemplateAlert schoolId={schoolId} />;
}

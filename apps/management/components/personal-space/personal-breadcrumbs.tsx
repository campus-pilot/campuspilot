'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@campuspilot/ui/components/breadcrumb';
import { useAssistantGate } from '@/components/assistant/assistant-access';
import { standalonePaperPermission } from '@/components/question-paper/paper-target';
import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
import { personalPapersHref } from './personal-space-model';

/** The paper's crumb before its name is known, without access, or once the paper is gone: a plain label, never an error. */
const PLAIN_PAPER_CRUMB = <BreadcrumbPage>Question paper</BreadcrumbPage>;

/**
 * A paper's name in the breadcrumbs: its subject (and class) as its details
 * state it, from the paper screen's own detail read (one cache entry). Read
 * only behind the gates the paper's procedures check (the standalone paper
 * permission, then the assistant), so nobody is refused for a crumb; the plain
 * label stands in while they load, when they refuse, and when the read fails.
 */
function PaperCrumb({ schoolId, paperId }: { schoolId: string; paperId: string }) {
  return (
    <RequirePermissions permissions={standalonePaperPermission(schoolId, 'read')} pending={PLAIN_PAPER_CRUMB} fallback={PLAIN_PAPER_CRUMB}>
      <AssistantGatedPaperCrumb schoolId={schoolId} paperId={paperId} />
    </RequirePermissions>
  );
}

function AssistantGatedPaperCrumb({ schoolId, paperId }: { schoolId: string; paperId: string }) {
  const gate = useAssistantGate(schoolId);
  return gate === 'allowed' ? <PaperNameCrumb schoolId={schoolId} paperId={paperId} /> : PLAIN_PAPER_CRUMB;
}

function PaperNameCrumb({ schoolId, paperId }: { schoolId: string; paperId: string }) {
  const detail = useQuery({ ...orpc.school.getStandalonePaperDetail.queryOptions({ input: { schoolId, paperId } }), retry: false });
  const details = detail.data?.paper.details;
  const title = details ? [details.subjectName, details.className].filter(Boolean).join(' · ') : '';
  return title ? <BreadcrumbPage className="max-w-48 truncate sm:max-w-72">{title}</BreadcrumbPage> : PLAIN_PAPER_CRUMB;
}

/**
 * The personal space's breadcrumbs (docs/personal-space.md): "Papers" on the
 * list, "Papers › {paper}" on a paper, where "Papers" leads back. Breadcrumbs
 * are the app's back navigation; there is no back button. On a phone only
 * the way back is shown, to fit the bar.
 */
export function PersonalBreadcrumbs({ schoolId }: { schoolId: string }) {
  const params = useParams();
  const paperId = typeof params.paperId === 'string' ? params.paperId : null;
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        <BreadcrumbItem>
          {paperId ? (
            <BreadcrumbLink asChild>
              <Link href={personalPapersHref(schoolId)}>Papers</Link>
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage>Papers</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {paperId ? (
          <>
            <BreadcrumbSeparator className="max-sm:hidden" />
            <BreadcrumbItem className="min-w-0 max-sm:hidden">
              <PaperCrumb schoolId={schoolId} paperId={paperId} />
            </BreadcrumbItem>
          </>
        ) : null}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

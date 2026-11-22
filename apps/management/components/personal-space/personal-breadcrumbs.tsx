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
import { orpc } from '@/lib/orpc';
import { personalPapersHref } from './personal-space-model';

/**
 * A paper's name in the breadcrumbs: its subject as its details state it,
 * from the paper screen's own detail read (one cache entry); "Question paper"
 * until it is known or when the paper states none.
 */
function PaperCrumb({ schoolId, paperId }: { schoolId: string; paperId: string }) {
  const detail = useQuery(orpc.school.getStandalonePaperDetail.queryOptions({ input: { schoolId, paperId } }));
  const details = detail.data?.paper.details;
  const title = details ? [details.subjectName, details.className].filter(Boolean).join(' · ') || 'Question paper' : 'Question paper';
  return <BreadcrumbPage className="max-w-48 truncate sm:max-w-72">{title}</BreadcrumbPage>;
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

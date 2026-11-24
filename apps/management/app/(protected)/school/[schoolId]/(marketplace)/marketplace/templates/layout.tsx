'use client';

import type { ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { skipToken, useQuery } from '@tanstack/react-query';
import {
  documentTypeSchema,
  type DocumentType,
} from '@campuspilot/api/routers/school/document/document.dto';
import { templateReadAction } from '@/components/documents/document-common';
import { useMarketplaceTypes } from '@/components/documents/document-template-marketplace';
import { offeredTypeOf } from '@/components/documents/marketplace-model';
import { ManagementShell, type ManagementShellState } from '@/components/management-shell';
import { resolveManagementPageActions } from '@/components/management-route';
import { marketplaceNavigation } from '@/components/marketplace-navigation';
import { RealSchoolOnly } from '@/components/personal-space/school-kind-gates';
import { SchoolDocumentHead } from '@/components/school-document-head';
import { useSchoolShellSessions } from '@/components/session-selection';
import { SessionSwitcher } from '@/components/session-switcher';
import { orpc } from '@/lib/orpc';
import { templateMarketplacePage, type MarketplaceRouteParams } from './_route';

/**
 * The template marketplace, a place of its own like Settings (which it is
 * reached from): the same header and session switcher, with its own sidebar
 * of document types instead of the dashboard's. A personal space has no
 * school templates, so it is a real school's only.
 */
export default function TemplateMarketplaceLayout({ children }: { children: ReactNode }) {
  const routeParams = useParams();
  const schoolId = String(routeParams.schoolId ?? '');
  return (
    <RealSchoolOnly schoolId={schoolId}>
      <TemplateMarketplaceShell>{children}</TemplateMarketplaceShell>
    </RealSchoolOnly>
  );
}

/**
 * The open type's designs for the sidebar, read only when the user may read
 * that type's templates (finance types have their own permission) so the
 * sidebar never waits for a request to be refused. It is the same catalog
 * query the page reads, so the two share one request.
 */
function useOpenTypeDesigns(schoolId: string, openType: DocumentType | null) {
  const permission = useQuery(
    orpc.authorization.checkPermissions.queryOptions({
      input: openType
        ? { permissions: [{ action: templateReadAction(openType), resource: { kind: 'school', schoolId } }] }
        : skipToken,
    }),
  );
  const canRead = permission.data?.results[0] === true;
  const catalog = useQuery(
    orpc.school.listMarketplaceTemplates.queryOptions({
      input: openType && canRead ? { schoolId, documentType: openType } : skipToken,
    }),
  );
  return catalog.data?.items ?? [];
}

function TemplateMarketplaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const routeParams = useParams();
  const schoolId = String(routeParams.schoolId ?? '');
  const { types } = useMarketplaceTypes(schoolId);
  const requested = documentTypeSchema.safeParse(routeParams.documentType);
  const openType = offeredTypeOf(requested.success ? requested.data : null, types);
  const designs = useOpenTypeDesigns(schoolId, openType);
  const { sessions, hasNoSessions, selectedSessionId } = useSchoolShellSessions(schoolId);
  const slug = String(routeParams.slug ?? '');
  const page = templateMarketplacePage.matches(pathname) ? templateMarketplacePage : undefined;
  const params: MarketplaceRouteParams = {
    schoolId,
    documentType: String(routeParams.documentType ?? ''),
    slug,
    designName: (slug && designs.find((design) => design.slug === slug)?.name) || '',
  };
  const state: ManagementShellState = {
    commandContext: { schoolId, sessionId: selectedSessionId, sessions },
    navigation: marketplaceNavigation({ schoolId, types, openType, designs }),
    breadcrumbs: page?.breadcrumbs(params) ?? [],
    footerContent: (
      <SessionSwitcher
        schoolId={schoolId}
        selectedSessionId={selectedSessionId}
        sessions={sessions}
        hasNoSessions={hasNoSessions}
      />
    ),
    navbarActions: resolveManagementPageActions(page, params),
  };
  return (
    <>
      <SchoolDocumentHead schoolId={schoolId} pageTitle={page?.title} />
      <ManagementShell state={state}>{children}</ManagementShell>
    </>
  );
}

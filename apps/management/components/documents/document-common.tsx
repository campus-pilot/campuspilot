'use client';
import { type ReactNode } from 'react';
import { DirtyGuard } from '@/components/exam/exam-common';
import { useQueryClient } from '@tanstack/react-query';
import {
  SCHOOL_ACTIONS,
  type PermissionCheck,
} from '@campuspilot/api/routers/authorization/authorization.dto';
import type { DocumentType } from '@campuspilot/api/routers/school/document/document.dto';
import {
  DocumentButton,
  DocumentNotice,
} from '@campuspilot/components/documents/document-controls';
import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
export { SCHOOL_ACTIONS };
export type DocumentScope = { schoolId: string; sessionId: string };
export type DocumentTemplateScope = {
  schoolId: string;
  documentType: DocumentType;
};
type SchoolDocumentAction = Extract<
  PermissionCheck,
  { resource: { kind: 'school' } }
>['action'];
export function documentPermission(
  schoolId: string,
  action: SchoolDocumentAction,
): PermissionCheck {
  return { action, resource: { kind: 'school', schoolId } } as PermissionCheck;
}
export function DocumentPermission({
  schoolId,
  action,
  children,
  fallback,
}: {
  schoolId: string;
  action: SchoolDocumentAction;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return (
    <RequirePermissions
      permissions={documentPermission(schoolId, action)}
      fallback={fallback}
    >
      {children}
    </RequirePermissions>
  );
}
export function DocumentReadError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => unknown;
}) {
  return (
    <DocumentNotice error>
      {error instanceof Error ? error.message : 'Unable to load documents.'}
      <DocumentButton
        variant="outline"
        className="ml-3"
        onClick={() => void retry()}
      >
        Retry
      </DocumentButton>
    </DocumentNotice>
  );
}
export function DocumentLoading() {
  return (
    <div
      role="status"
      aria-label="Loading documents"
      className="h-60 animate-pulse rounded-xl bg-muted"
    />
  );
}
export function useDocumentCache() {
  const cache = useQueryClient();
  return {
    templates: (scope: DocumentTemplateScope) =>
      cache.invalidateQueries({
        queryKey: orpc.school.getActiveDocumentTemplate.key({ input: scope }),
      }),
    artifacts: (schoolId: string) =>
      cache.invalidateQueries({
        queryKey: orpc.school.listDocumentArtifacts.key({
          input: { schoolId },
        }),
      }),
  };
}
/** Document drafts use the same app-dialog navigation guard as exam editors. */
export function DocumentDirtyGuard({ dirty }: { dirty: boolean }) {
  return <DirtyGuard dirty={dirty} />;
}

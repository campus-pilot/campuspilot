'use client';
import { useCallback, useRef, type ReactNode } from 'react';
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
import { registerNavigationGuard } from '@/lib/navigation-guard';
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
/** Callback-ref cleanup owns listeners; the current form state is read only when
 * navigation occurs, so no effect or extra input state is required.
 */
export function DocumentDirtyGuard({ dirty }: { dirty: boolean }) {
  const current = useRef(dirty);
  current.current = dirty;
  const ref = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const confirm = () =>
      !current.current || window.confirm('Discard unsaved template changes?');
    const unregister = registerNavigationGuard(confirm);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (current.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest('a[href]')
          : null;
      if (link && link.getAttribute('target') !== '_blank' && !confirm()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const traverse = (event: NavigateEvent) => {
      if (event.navigationType === 'traverse' && event.cancelable && !confirm())
        event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    window.navigation?.addEventListener('navigate', traverse);
    return () => {
      unregister();
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
      window.navigation?.removeEventListener('navigate', traverse);
    };
  }, []);
  return (
    <div ref={ref}>
      {dirty && <DocumentNotice>Unsaved template changes</DocumentNotice>}
    </div>
  );
}

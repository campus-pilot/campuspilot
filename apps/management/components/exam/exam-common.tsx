'use client';
import { useCallback, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import {
  ExamPageFrame,
  LoadingExam,
  Notice,
  ReadError,
} from '@campuspilot/components/exam/exam-controls';
export {
  ExamButton,
  ExamInput,
  ExamSelect,
  ExamPager,
  Issues,
  LoadingExam,
  Notice,
  ReadError,
  submitExam,
} from '@campuspilot/components/exam/exam-controls';
import { orpc } from '@/lib/orpc';
import { registerNavigationGuard } from '@/lib/navigation-guard';
import { schoolPermission, type SessionScope } from './exam-model';

export function ExamFrame({
  title,
  description,
  back,
  children,
}: {
  title: string;
  description: string;
  back?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <ExamPageFrame
      title={title}
      description={description}
      back={
        back && (
          <Link
            className="flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground"
            href={back.href}
          >
            ← {back.label}
          </Link>
        )
      }
    >
      {children}
    </ExamPageFrame>
  );
}

/** Session activity is independent of permissions and session dates. Denied/failed reads keep mutations closed. */
export function ExamSession({
  scope,
  children,
}: {
  scope: SessionScope;
  children: (active: boolean) => ReactNode;
}) {
  return (
    <RequirePermissions
      permissions={schoolPermission(
        scope.schoolId,
        SCHOOL_ACTIONS.READ_SESSION,
      )}
      fallback={
        <>
          <Notice>
            Session activity is unavailable. Examination is read-only.
          </Notice>
          {children(false)}
        </>
      }
    >
      <SessionData scope={scope}>{children}</SessionData>
    </RequirePermissions>
  );
}
function SessionData({
  scope,
  children,
}: {
  scope: SessionScope;
  children: (active: boolean) => ReactNode;
}) {
  const query = useQuery(orpc.school.getSession.queryOptions({ input: scope }));
  if (query.isPending) return <LoadingExam />;
  return (
    <>
      {query.isError ? (
        <ReadError error={query.error} retry={query.refetch} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Session {query.data.sessionStartYear}–{query.data.sessionEndYear}
        </p>
      )}
      {!query.isError && !query.data.isActive && (
        <Notice>Historical session · Read-only</Notice>
      )}
      {children(!query.isError && query.data.isActive)}
    </>
  );
}
/** Callback-ref lifecycle installs browser guards without an effect; current form state is read at navigation time. */
export function DirtyGuard({ dirty }: { dirty: boolean }) {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest('a[href]')
          : null;
      if (
        dirtyRef.current &&
        link &&
        link.getAttribute('href') !== '#' &&
        link.getAttribute('target') !== '_blank' &&
        !window.confirm(
          'Discard unsaved examination changes and leave? Cancel to keep editing.',
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const traverse = (event: NavigateEvent) => {
      if (
        event.navigationType === 'traverse' &&
        event.cancelable &&
        dirtyRef.current &&
        !window.confirm(
          'Discard unsaved examination changes and go back? Cancel to keep editing.',
        )
      )
        event.preventDefault();
    };
    window.navigation?.addEventListener('navigate', traverse);
    const unregister = registerNavigationGuard(
      () =>
        !dirtyRef.current ||
        window.confirm(
          'Discard unsaved examination changes and leave? Cancel to keep editing.',
        ),
    );
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    return () => {
      unregister();
      window.navigation?.removeEventListener('navigate', traverse);
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
    };
  }, []);
  return (
    <div ref={ref}>
      {dirty && (
        <Notice>
          Unsaved changes · Keep this page open to retain your edits.
        </Notice>
      )}
    </div>
  );
}
/** Partial typed input keys match every page/filter variant within this scope. */
export function useExamCache() {
  const cache = useQueryClient();
  const invalidate = (...keys: QueryKey[]) =>
    Promise.all(keys.map((queryKey) => cache.invalidateQueries({ queryKey })));
  return {
    cache,
    definitions: ({ schoolId, sessionId }: SessionScope, examSlug: string) => {
      const scope = { schoolId, sessionId };
      return invalidate(
        orpc.school.listExams.key({ input: scope }),
        orpc.school.getSession.key({ input: scope }),
        orpc.school.getExam.key({ input: { ...scope, examSlug } }),
        orpc.school.getExamContext.key({ input: { ...scope, examSlug } }),
      );
    },
    plans: ({
      schoolId,
      sessionId,
      examSlug,
    }: SessionScope & { examSlug: string }) =>
      invalidate(
        orpc.school.listExamPlans.key({
          input: { schoolId, sessionId, examSlug },
        }),
      ),
    results: ({
      schoolId,
      sessionId,
      classId,
      examPlanId,
    }: SessionScope & { classId: string; examPlanId: string }) => {
      const scope = { schoolId, sessionId, classId, examPlanId };
      return invalidate(
        orpc.school.listExamRoster.key({ input: scope }),
        orpc.school.listExamResults.key({ input: scope }),
      );
    },
  };
}

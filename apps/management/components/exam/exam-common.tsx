'use client';
import { useCallback, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import {
  LoadingExam,
  Notice,
  ReadError,
} from '@campuspilot/components/exam/exam-controls';
export {
  ExamPageFrame as ExamFrame,
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
      {query.isError && <ReadError error={query.error} retry={query.refetch} />}
      {!query.isError && !query.data.isActive && (
        <Notice>Historical session · Read-only</Notice>
      )}
      {children(!query.isError && query.data.isActive)}
    </>
  );
}
/** In-app navigation waits for an app dialog. Browser reload/tab closure still
 * uses beforeunload because browsers cannot wait for an asynchronous app dialog.
 * Callback refs bind listeners to the committed editor without an effect.
 */
export function DirtyGuard({ dirty }: { dirty: boolean }) {
  const router = useRouter();
  const dirtyRef = useRef(dirty);
  const leaving = useRef(false);
  const decision = useRef<((discard: boolean) => void) | null>(null);
  dirtyRef.current = dirty;
  const form = useForm({
    defaultValues: { confirming: false },
    validators: { onChange: z.object({ confirming: z.boolean() }) },
  });
  const request = useCallback(() => {
    if (!dirtyRef.current || leaving.current) return Promise.resolve(true);
    // Repeated clicks while the modal is open must not queue competing navigations.
    if (decision.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      decision.current = resolve;
      form.setFieldValue('confirming', true);
    });
  }, [form]);
  const decide = (discard: boolean) => {
    const resolve = decision.current;
    decision.current = null;
    leaving.current = discard;
    form.setFieldValue('confirming', false);
    resolve?.(discard);
  };
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const beforeUnload = (event: BeforeUnloadEvent) => {
        if (dirtyRef.current && !leaving.current) {
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
          event.button !== 0 ||
          !dirtyRef.current ||
          leaving.current
        )
          return;
        const link =
          event.target instanceof Element
            ? event.target.closest<HTMLAnchorElement>('a[href]')
            : null;
        if (
          !link ||
          link.href === window.location.href ||
          link.target === '_blank' ||
          link.hasAttribute('download') ||
          link.getAttribute('href')?.startsWith('#')
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        void request().then((discard) => {
          if (!discard) return;
          if (link.origin === window.location.origin)
            router.push(`${link.pathname}${link.search}${link.hash}`);
          else window.location.assign(link.href);
        });
      };
      const traverse = (event: NavigateEvent) => {
        if (
          event.navigationType !== 'traverse' ||
          !event.cancelable ||
          !dirtyRef.current ||
          leaving.current
        )
          return;
        event.preventDefault();
        void request().then((discard) => {
          if (discard)
            void window.navigation?.traverseTo(event.destination.key);
        });
      };
      const unregister = registerNavigationGuard(request);
      window.navigation?.addEventListener('navigate', traverse);
      window.addEventListener('beforeunload', beforeUnload);
      document.addEventListener('click', click, true);
      return () => {
        unregister();
        decision.current?.(false);
        decision.current = null;
        window.navigation?.removeEventListener('navigate', traverse);
        window.removeEventListener('beforeunload', beforeUnload);
        document.removeEventListener('click', click, true);
      };
    },
    [request, router],
  );
  return (
    <div ref={ref}>
      <form.Subscribe selector={(state) => state.values.confirming}>
        {(confirming) => (
          <ConfirmationDialog
            open={confirming}
            title="Discard unsaved changes?"
            description="Your examination edits will be lost. Saved data will stay as it was."
            confirmLabel="Discard changes"
            cancelLabel="Keep editing"
            onOpenChange={(open) => {
              if (!open) decide(false);
            }}
            onConfirm={() => decide(true)}
          />
        )}
      </form.Subscribe>
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
    plans: ({
      schoolId,
      sessionId,
      examSlug,
    }: SessionScope & { examSlug: string }) =>
      invalidate(
        orpc.school.listExams.key({ input: { schoolId, sessionId } }),
        orpc.school.getExamOverview.key({
          input: { schoolId, sessionId, examSlug },
        }),
        orpc.school.listExamClasses.key({
          input: { schoolId, sessionId, examSlug },
        }),
        orpc.school.getExamPlanPreview.key({
          input: { schoolId, sessionId, examSlug },
        }),
        orpc.school.listExamPlans.key({
          input: { schoolId, sessionId, examSlug },
        }),
      ),
  };
}

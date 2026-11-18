'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { z } from 'zod';
import type { listQuestionPapersOutputSchema } from '@campuspilot/api/routers/school/question-paper/question-paper.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { QuestionPaperFilteredClasses } from '@campuspilot/components/question-paper/question-paper-filtered-classes';
import { openClassOf } from '@campuspilot/components/question-paper/question-paper-model';
import { RequirePermissions } from '@/components/require-permissions';
import { LoadingExam, Notice, ReadError } from '@/components/exam/exam-common';
import { questionPaperWorkspaceHref, schoolPermission, type ExamScope } from '@/components/exam/exam-model';
import { orpc } from '@/lib/orpc';
import { storeModeFilter, useModeFilterExternalRevision, useStoredModeFilter } from './mode-filter-store';
import { replaceOpenClass } from './question-paper-list-model';
import { QuestionPaperAssistantGate } from './question-paper-assistant-gate';
import { QuestionPaperTemplateAlertForSchool } from './question-paper-template-alert';

const LIST_POLL_MS = 5000;

type PaperClasses = z.infer<typeof listQuestionPapersOutputSchema>['classes'];

/**
 * The Question paper tab: the classes you may open as an accordion (one open
 * at a time, kept in the address as `?class=`), each listing every subject
 * and assessment mode of the examination with the state of its paper, and a
 * mode filter remembered per school. The list is read again every few
 * seconds while any paper is being generated, whichever class is open.
 */
export function QuestionPaperPage({ scope }: { scope: ExamScope }) {
  return (
    <RequirePermissions
      permissions={schoolPermission(scope.schoolId, SCHOOL_ACTIONS.READ_EXAM_PLANS)}
      fallback={<Notice>Question papers are unavailable for your account.</Notice>}
      pending={<LoadingExam />}
    >
      <QuestionPaperAssistantGate schoolId={scope.schoolId}>
        <PaperList scope={scope} />
      </QuestionPaperAssistantGate>
    </RequirePermissions>
  );
}

function PaperList({ scope }: { scope: ExamScope }) {
  const storedModes = useStoredModeFilter(scope.schoolId);
  const externalRevision = useModeFilterExternalRevision(scope.schoolId);
  const query = useQuery(
    orpc.school.listQuestionPapers.queryOptions({
      input: scope,
      // Every class counts, open or not, so a closed class still updates.
      refetchInterval: (current) =>
        current.state.data?.classes.some((item) =>
          item.subjects.some((subject) => subject.modes.some((mode) => mode.paper?.activeJob)),
        )
          ? LIST_POLL_MS
          : false,
    }),
  );
  if (query.data === undefined) {
    return query.isPending ? <LoadingExam /> : <ReadError error={query.error} retry={query.refetch} />;
  }
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <QuestionPaperTemplateAlertForSchool schoolId={scope.schoolId} />
      <p className="text-sm text-muted-foreground">
        Upload photos of a question paper for a subject and let the AI turn them into a printable paper with your
        school&apos;s heading and footer.
      </p>
      {query.data.classes.length === 0 ? (
        <NoClasses />
      ) : storedModes === undefined ? (
        // Only during server rendering and the hydration pass, when local storage cannot be read. The
        // list is never loaded then (nothing prefetches it on the server or restores a cache), so this
        // shows no later than the query's own loading state would; an unfiltered list here would only
        // flash rows the stored filter then hides.
        <LoadingExam />
      ) : (
        // The filter form is seeded from the stored entry when it mounts: once per school, and again
        // after another tab changed the entry. This tab's own writes keep it mounted (an open popover stays open).
        <FilteredClasses
          key={`${scope.schoolId}:${externalRevision}`}
          scope={scope}
          classes={query.data.classes}
          storedModes={storedModes}
        />
      )}
    </div>
  );
}

function NoClasses() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <p className="text-sm font-medium">No classes to show</p>
      <p className="text-xs text-muted-foreground">
        You can open the question papers of the classes you teach, or of every class if you are a principal, manager or
        exam coordinator.
      </p>
    </div>
  );
}

/**
 * The open class is the `class` parameter (`openClassOf`: an id not in the
 * list opens nothing); `replaceOpenClass` rewrites it.
 *
 * The parameter is written with `window.history.replaceState`, not
 * `router.replace`. This route is an async server component, so a router
 * navigation would fetch its RSC payload again on every toggle, and the
 * accordion would not move until that returned (rapid taps raced each
 * other). Since Next 14.1 the App Router patches the History API and syncs
 * `useSearchParams` (and `usePathname`) with it, so a `replaceState` re-renders
 * this hook with the new parameter at once, without a request and without
 * scrolling, while Back and reload keep working with the rewritten address.
 */
function useOpenClassParam(classes: PaperClasses) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return {
    openClassId: openClassOf(searchParams.get('class'), classes),
    setOpenClass: (classId: string | null) =>
      replaceOpenClass(
        { pathname, search: searchParams.toString(), replace: (href) => window.history.replaceState(null, '', href) },
        classId,
      ),
  };
}

function FilteredClasses({ scope, classes, storedModes }: { scope: ExamScope; classes: PaperClasses; storedModes: string[] }) {
  const router = useRouter();
  const { openClassId, setOpenClass } = useOpenClassParam(classes);
  return (
    <QuestionPaperFilteredClasses
      classes={classes}
      storedModes={storedModes}
      onStoredModesChange={(slugs) => storeModeFilter(scope.schoolId, slugs)}
      openClassId={openClassId}
      onOpenClassChange={setOpenClass}
      hrefOf={(cell) => questionPaperWorkspaceHref({ ...scope, ...cell })}
      onOpen={(cell) => router.push(questionPaperWorkspaceHref({ ...scope, ...cell }))}
    />
  );
}

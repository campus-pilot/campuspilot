'use client';

import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import type { listQuestionPapersOutputSchema } from '@campuspilot/api/routers/school/question-paper/question-paper.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { TableFilterBar } from '@campuspilot/components/data-grid';
import { QuestionPaperClassAccordion } from '@campuspilot/components/question-paper/question-paper-class-accordion';
import {
  applyModeFilter,
  mergeModeSelection,
  openClassOf,
  paperModeOptions,
  visibleModeSelection,
  type PaperModeOption,
} from '@campuspilot/components/question-paper/question-paper-model';
import { RequirePermissions } from '@/components/require-permissions';
import { LoadingExam, Notice, ReadError } from '@/components/exam/exam-common';
import { questionPaperWorkspaceHref, schoolPermission, type ExamScope } from '@/components/exam/exam-model';
import { orpc } from '@/lib/orpc';
import { storeModeFilter, useStoredModeFilter } from './mode-filter-store';
import { modeFilterSchema, withClassParam } from './question-paper-list-model';
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
        <LoadingExam />
      ) : (
        // Keyed by school: the filter form is seeded once per school from the stored entry.
        <FilteredClasses key={scope.schoolId} scope={scope} classes={query.data.classes} storedModes={storedModes} />
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
 * The mode filter's form: seeded from the stored entry (all stored slugs,
 * including those of other examinations) and writing every change back to
 * the store through the form's listener, so local storage stays the source
 * of truth across reloads without an effect.
 */
function useModeFilterForm(schoolId: string, storedModes: string[]) {
  return useForm({
    defaultValues: { modes: storedModes },
    validators: { onChange: z.object({ modes: modeFilterSchema }) },
    listeners: {
      onChange: ({ formApi }) => {
        const parsed = modeFilterSchema.safeParse(formApi.state.values.modes);
        if (parsed.success) storeModeFilter(schoolId, parsed.data);
      },
    },
  });
}

/**
 * The open class is the `class` parameter (`openClassOf`: an id not in the
 * list opens nothing). Opening or collapsing a class replaces the address
 * without scrolling, so Back does not step through every toggle.
 */
function useOpenClassParam(classes: PaperClasses) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return {
    openClassId: openClassOf(searchParams.get('class'), classes),
    setOpenClass: (classId: string | null) =>
      router.replace(`${pathname}${withClassParam(searchParams.toString(), classId)}`, { scroll: false }),
  };
}

function FilteredClasses({ scope, classes, storedModes }: { scope: ExamScope; classes: PaperClasses; storedModes: string[] }) {
  const router = useRouter();
  const form = useModeFilterForm(scope.schoolId, storedModes);
  const { openClassId, setOpenClass } = useOpenClassParam(classes);
  const options = paperModeOptions(classes);
  return (
    <form.Field name="modes">
      {(field) => {
        const visible = visibleModeSelection(field.state.value, options);
        return (
          <div className="flex min-w-0 flex-col gap-3">
            <ModeFilter
              options={options}
              visible={visible}
              errors={field.state.meta.errors}
              onChange={(next) => field.handleChange(mergeModeSelection(field.state.value, options, next))}
            />
            <QuestionPaperClassAccordion
              classes={applyModeFilter(classes, visible)}
              openClassId={openClassId}
              onOpenClassChange={setOpenClass}
              hrefOf={(cell) => questionPaperWorkspaceHref({ ...scope, ...cell })}
              onOpen={(cell) => router.push(questionPaperWorkspaceHref({ ...scope, ...cell }))}
            />
          </div>
        );
      }}
    </form.Field>
  );
}

/** The multi-select mode filter, as on the admission tables; nothing selected shows every mode. */
function ModeFilter({
  options,
  visible,
  errors,
  onChange,
}: {
  options: PaperModeOption[];
  visible: string[];
  errors: unknown[];
  onChange: (next: string[]) => void;
}) {
  const message = errors
    .map((error) => (typeof error === 'string' ? error : (error as { message?: string } | undefined)?.message))
    .filter(Boolean)
    .join(', ');
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <TableFilterBar<{ modes: string[] | undefined }>
        filters={[
          {
            id: 'modes',
            label: 'Mode',
            type: 'multiple',
            options: options.map((option) => ({ label: option.name, value: option.slug })),
          },
        ]}
        values={{ modes: visible.length > 0 ? visible : undefined }}
        onValuesChange={(values) => onChange(values.modes ?? [])}
      />
      {message ? (
        <p role="alert" className="text-xs text-destructive">
          {message}
        </p>
      ) : null}
    </div>
  );
}

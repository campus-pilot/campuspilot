import type { ReactNode } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { Button } from '@campuspilot/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@campuspilot/ui/components/collapsible';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@campuspilot/ui/components/command';
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '@campuspilot/ui/components/sidebar';
import { AppShellSidebarSubLink } from '../app-shell';
import type { QueryBoundaryState } from '../query-boundary';

/**
 * The Question papers entry of the sidebar, as data passed in: the exams of
 * the selected session, each folding open to the classes whose papers the
 * person may open. The app reads both lists and navigates; nothing here
 * fetches. It is the content of an `AppShellNavigationDisclosure`, so it
 * renders a sidebar sub-menu and works the same in the desktop sidebar and
 * the mobile sheet.
 */

/**
 * One examination of the session. `detail` is a short note beside its name
 * (for example "Completed"). `hasPlan` says whether the examination has any
 * subject plan: its Question paper tab exists only then, so an examination
 * without one is listed (it is part of the session) but cannot be opened,
 * and says "No plan yet" rather than an empty class list.
 */
export type QuestionPaperNavExam = { slug: string; name: string; detail?: string; hasPlan: boolean };
/** One class whose papers the person may open. */
export type QuestionPaperNavClass = { classId: string; className: string };

/** A status line inside the sub-menu (loading, empty). */
function NavNote({ children }: { children: ReactNode }) {
  return (
    <SidebarMenuSubItem>
      <p className="px-2 py-1 text-xs text-muted-foreground">{children}</p>
    </SidebarMenuSubItem>
  );
}

/** A read that failed with nothing held: what failed and a retry. */
function NavReadError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <SidebarMenuSubItem>
      <div role="alert" className="flex flex-wrap items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
        <span>{label}</span>
        <Button type="button" variant="link" size="xs" className="px-0" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </SidebarMenuSubItem>
  );
}

/**
 * The session's examinations, in the order the caller gives (the session's
 * explicit exam order). Completed examinations stay: their papers can still
 * be viewed. `footer` is an app-owned last row, such as the permission-gated
 * link to add an examination.
 */
export function QuestionPaperNavExams({
  exams,
  onRetry,
  renderClasses,
  footer,
}: {
  exams: QueryBoundaryState<readonly QuestionPaperNavExam[]>;
  onRetry: () => void;
  /** The classes of one examination, rendered (and so read) only while that examination is open. */
  renderClasses: (exam: QuestionPaperNavExam) => ReactNode;
  footer?: ReactNode;
}) {
  return (
    <SidebarMenuSub>
      <ExamRows exams={exams} onRetry={onRetry} renderClasses={renderClasses} />
      {footer}
    </SidebarMenuSub>
  );
}

function ExamRows({
  exams,
  onRetry,
  renderClasses,
}: {
  exams: QueryBoundaryState<readonly QuestionPaperNavExam[]>;
  onRetry: () => void;
  renderClasses: (exam: QuestionPaperNavExam) => ReactNode;
}) {
  if (exams.kind === 'pending') return <NavNote>Loading examinations…</NavNote>;
  if (exams.kind === 'failed') return <NavReadError label="Examinations could not be loaded." onRetry={onRetry} />;
  if (exams.data.length === 0) return <NavNote>No examinations in this session</NavNote>;
  return exams.data.map((exam) =>
    exam.hasPlan ? (
      <ExamDisclosure key={exam.slug} exam={exam} renderClasses={renderClasses} />
    ) : (
      <PlanlessExam key={exam.slug} exam={exam} />
    ),
  );
}

/**
 * An examination without a plan: shown, so the session's list is complete,
 * but disabled, since it has no papers yet and no Question paper tab. It
 * says why instead of opening to a class list that would look like a
 * permission problem.
 */
function PlanlessExam({ exam }: { exam: QuestionPaperNavExam }) {
  const note = exam.detail ? `No plan yet · ${exam.detail}` : 'No plan yet';
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild aria-disabled className="w-full">
        <button type="button" disabled>
          <ChevronRight aria-hidden className="invisible" />
          <span className="min-w-0 flex-1 truncate text-left">{exam.name}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{note}</span>
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

/** One examination; opening it shows (and reads) its classes. */
function ExamDisclosure({
  exam,
  renderClasses,
}: {
  exam: QuestionPaperNavExam;
  renderClasses: (exam: QuestionPaperNavExam) => ReactNode;
}) {
  return (
    <Collapsible asChild className="group/exam">
      <SidebarMenuSubItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuSubButton asChild className="w-full">
            <button type="button">
              <ChevronRight aria-hidden className="transition-transform group-data-[state=open]/exam:rotate-90" />
              <span className="min-w-0 flex-1 truncate text-left">{exam.name}</span>
              {exam.detail ? <span className="shrink-0 text-[10px] text-muted-foreground">{exam.detail}</span> : null}
            </button>
          </SidebarMenuSubButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ExamClasses exam={exam} renderClasses={renderClasses} />
        </CollapsibleContent>
      </SidebarMenuSubItem>
    </Collapsible>
  );
}

/** Calls `renderClasses` only when mounted, that is while the examination is open. */
function ExamClasses({
  exam,
  renderClasses,
}: {
  exam: QuestionPaperNavExam;
  renderClasses: (exam: QuestionPaperNavExam) => ReactNode;
}) {
  return renderClasses(exam);
}

/**
 * The classes of one examination as a searchable list (cmdk, as in the
 * shared combobox), since a school can have many classes. cmdk filters the
 * names on the client; the list itself is exactly what the server returned
 * (only classes the person may open), never narrowed by a rule of ours.
 * It is shown only for an examination with a plan (`hasPlan`), so an empty
 * list means the plan's classes are not ones the person may open, and says
 * so; an examination without a plan says "No plan yet" in its row instead.
 * The search field is always shown: cmdk options are reached from it with
 * the arrow keys, so without it a keyboard could not reach them. The search
 * matches class names only (`matchesClassName`), never the ids that serve as
 * cmdk values.
 */
export function QuestionPaperNavClasses({
  examName,
  classes,
  onRetry,
  onOpen,
}: {
  examName: string;
  classes: QueryBoundaryState<readonly QuestionPaperNavClass[]>;
  onRetry: () => void;
  /** Goes to the class's papers (and closes the mobile sheet). */
  onOpen: (classId: string) => void;
}) {
  if (classes.kind === 'pending') return <ClassesNote>Loading classes…</ClassesNote>;
  if (classes.kind === 'failed') {
    return (
      <SidebarMenuSub>
        <NavReadError label="Classes could not be loaded." onRetry={onRetry} />
      </SidebarMenuSub>
    );
  }
  if (classes.data.length === 0) return <ClassesNote>No classes you can open</ClassesNote>;
  return (
    <Command
      label={`Search classes of ${examName}`}
      filter={matchesClassName}
      className="mt-1 rounded-none bg-transparent p-0 pl-3"
    >
      <CommandInput placeholder="Search classes…" />
      <CommandList className="max-h-64 py-1">
        <CommandEmpty className="py-2">No class matches.</CommandEmpty>
        {classes.data.map((classView) => (
          <CommandItem
            key={classView.classId}
            value={classView.classId}
            keywords={[classView.className]}
            onSelect={() => onOpen(classView.classId)}
            className="cursor-pointer"
          >
            {classView.className}
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}

/** cmdk filter: 1 when a class's name (its only keyword) contains the search, ignoring case. */
export function matchesClassName(_value: string, search: string, keywords?: string[]): number {
  const needle = search.trim().toLocaleLowerCase();
  return (keywords ?? []).some((keyword) => keyword.toLocaleLowerCase().includes(needle)) ? 1 : 0;
}

/** A status line under an examination. */
function ClassesNote({ children }: { children: ReactNode }) {
  return (
    <SidebarMenuSub>
      <NavNote>{children}</NavNote>
    </SidebarMenuSub>
  );
}

/**
 * The last row of the examination list: a link that adds an examination.
 * The app decides whether to show it (the permission) and where it goes.
 */
export function QuestionPaperNavCreateLink({ href }: { href: string }) {
  return (
    <SidebarMenuSubItem>
      <AppShellSidebarSubLink href={href}>
        <Plus aria-hidden />
        <span>Add examination</span>
      </AppShellSidebarSubLink>
    </SidebarMenuSubItem>
  );
}

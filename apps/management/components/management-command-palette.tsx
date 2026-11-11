'use client';

import {
  Fragment,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from 'react';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import type { AdmissionListItemDto } from '@campuspilot/api/routers/school/admission/admission.dto';
import type { SchoolSessionDto } from '@campuspilot/api/routers/school/session/session.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@campuspilot/ui/components/avatar';
import { Button } from '@campuspilot/ui/components/button';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  CommandSeparator,
} from '@campuspilot/ui/components/command';
import {
  BookOpenCheck,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  HandCoins,
  Landmark,
  LoaderCircle,
  Percent,
  RotateCcw,
  UserRound,
} from 'lucide-react';
import { z } from 'zod';
import { client, orpc } from '@/lib/orpc';
import { confirmNavigation } from '@/lib/navigation-guard';
import { getAdmissionPhotoUrl } from '@/lib/admission-photo';
import { AskAssistantCommand, PaletteAssistantView } from './assistant/assistant-palette';
import { CommandRow } from './command-row';
import { RequirePermissions } from './require-permissions';
import { schoolHref, schoolSessionHref } from './school-route';
import {
  createManagementCommandRegistry,
  commandFuzzyScore,
  filterManagementCommands,
  type ManagementCommandContext,
} from './management-command-registry';
import {
  collectAllPages,
  hasFinanceActionConfig,
  hasStudentExamResult,
  mapWithConcurrency,
  schoolSessionLabel,
} from './management-command-model';
import {
  AdjustmentDialog,
  PaymentDialog,
  type FinanceSessionOption,
} from './billing/admission-finance-dialogs';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
type ExamSearchItem = {
  slug: string;
  name: string;
  status: 'ready' | 'active' | 'completed' | null;
};
type FinanceDialogSelection = {
  kind: 'payment' | 'adjustment';
  admissionId: string;
  session: FinanceSessionOption;
};

const querySchema = z.object({ query: z.string().max(200) });

const paletteItemClassName =
  'my-0.5 min-h-10 cursor-pointer gap-2.5 rounded-lg border border-transparent px-2 py-1.5 transition-colors data-selected:border-border data-selected:bg-muted/70';

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}


function ProviderStatus({
  heading,
  label,
  retry,
}: {
  heading: string;
  label: string;
  retry?: () => void;
}) {
  return (
    <CommandGroup heading={heading}>
      <CommandItem
        className={paletteItemClassName}
        value={`provider:${heading}:${label}`}
        disabled={!retry}
        onSelect={retry}
      >
        {retry ? (
          <RotateCcw className="size-4" aria-hidden />
        ) : (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        )}
        <span className="min-w-0 flex-1 text-muted-foreground">{label}</span>
        {retry ? (
          <CommandShortcut className="hidden sm:inline">Retry</CommandShortcut>
        ) : null}
      </CommandItem>
    </CommandGroup>
  );
}

function ResultProviderStatus({
  label,
  retry,
}: {
  label: string;
  retry?: () => void;
}) {
  return (
    <>
      <CommandSeparator />
      <ProviderStatus heading="Results" label={label} retry={retry} />
    </>
  );
}

function useAllExams(schoolId: string, sessionId: string) {
  return useQuery({
    queryKey: [
      ...orpc.school.listExams.queryKey({ input: { schoolId, sessionId } }),
      'command-palette-all-pages',
    ],
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      return collectAllPages<ExamSearchItem>((page) =>
        client.school.listExams({
          schoolId,
          sessionId,
          page,
          limit: 20,
        }),
      );
    },
  });
}

function ExaminationsProvider({
  context,
  query,
  navigate,
}: {
  context: ManagementCommandContext;
  query: string;
  navigate: (href: string) => Promise<void>;
}) {
  if (!context.sessionId) return null;
  return (
    <RequirePermissions
      permissions={{
        action: SCHOOL_ACTIONS.READ_EXAMS,
        resource: { kind: 'school', schoolId: context.schoolId },
      }}
    >
      <ExaminationResults
        context={{ ...context, sessionId: context.sessionId }}
        query={query}
        navigate={navigate}
      />
    </RequirePermissions>
  );
}

function ExaminationResults({
  context,
  query,
  navigate,
}: {
  context: ManagementCommandContext & { sessionId: string };
  query: string;
  navigate: (href: string) => Promise<void>;
}) {
  const examsQuery = useAllExams(context.schoolId, context.sessionId);
  if (!query.trim()) return null;
  if (examsQuery.isPending) {
    return (
      <ProviderStatus heading="Examinations" label="Searching examinations…" />
    );
  }
  if (examsQuery.isError) {
    return (
      <ProviderStatus
        heading="Examinations"
        label="Examinations could not be loaded"
        retry={() => void examsQuery.refetch()}
      />
    );
  }
  const exams = query.trim()
    ? (examsQuery.data ?? [])
        .map((exam) => ({
          exam,
          score: commandFuzzyScore(query, [exam.name, exam.slug]),
        }))
        .filter(
          (entry): entry is { exam: ExamSearchItem; score: number } =>
            entry.score !== null,
        )
        .sort((left, right) => right.score - left.score)
    : [];
  if (!exams.length) return null;
  return (
    <CommandGroup heading="Examinations">
      {exams.map(({ exam }) => (
        <CommandItem
          className={paletteItemClassName}
          key={exam.slug}
          value={`exam:${exam.slug}`}
          onSelect={() =>
            void navigate(
              schoolSessionHref(
                context.schoolId,
                context.sessionId,
                `/exam/${encodeURIComponent(exam.slug)}`,
              ),
            )
          }
        >
          <CommandRow
            icon={ClipboardCheck}
            label={exam.name}
            description="Examination"
          />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function AdmissionsProvider({
  context,
  query,
  onSelect,
}: {
  context: ManagementCommandContext;
  query: string;
  onSelect: (admission: AdmissionListItemDto) => void;
}) {
  if (!context.sessionId || !query.trim()) return null;
  return (
    <RequirePermissions
      permissions={{
        action: SCHOOL_ACTIONS.LIST_ADMISSIONS,
        resource: { kind: 'school', schoolId: context.schoolId },
      }}
    >
      <AdmissionResults
        context={{ ...context, sessionId: context.sessionId }}
        query={query}
        onSelect={onSelect}
      />
    </RequirePermissions>
  );
}

function AdmissionResults({
  context,
  query,
  onSelect,
}: {
  context: ManagementCommandContext & { sessionId: string };
  query: string;
  onSelect: (admission: AdmissionListItemDto) => void;
}) {
  const admissionsQuery = useQuery(
    orpc.school.listAdmissions.queryOptions({
      input: {
        schoolId: context.schoolId,
        searchQuery: query,
        searchMode: 'fuzzy',
        page: 1,
        limit: 5,
        orderBy: { field: 'relevance', direction: 'desc' },
        filters: {
          registered: true,
          placementSessionId: context.sessionId,
          placementStatus: 'assigned',
        },
      },
    }),
  );
  const admissions = admissionsQuery.data?.items ?? [];
  if (admissionsQuery.isPending) {
    return <ProviderStatus heading="Admissions" label="Searching students…" />;
  }
  if (admissionsQuery.isError) {
    return (
      <ProviderStatus
        heading="Admissions"
        label="Students could not be loaded"
        retry={() => void admissionsQuery.refetch()}
      />
    );
  }
  if (!admissions.length) return null;
  return (
    <CommandGroup
      heading={
        <span className="flex w-full items-center justify-between gap-3">
          <span>Admissions</span>
          <span>
            {admissions.length}{' '}
            {admissions.length === 1 ? 'student' : 'students'}
          </span>
        </span>
      }
    >
      {admissions.map((admission) => (
        <CommandItem
          className={paletteItemClassName}
          key={admission.id}
          value={`admission:${admission.id}`}
          onSelect={() => onSelect(admission)}
        >
          <Avatar
            size="sm"
            className="opacity-60 transition-opacity group-data-selected/command-item:opacity-100"
          >
            <AvatarImage
              src={getAdmissionPhotoUrl(
                context.schoolId,
                admission.id,
                admission.photoS3Key,
              )}
              alt=""
            />
            <AvatarFallback>{initials(admission.name)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{admission.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {admission.admissionNo}
            </span>
          </span>
          <CommandShortcut className="flex">
            <ChevronRight className="size-3.5" aria-hidden />
          </CommandShortcut>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function FinanceAction({
  context,
  sessionLabel,
  admission,
  kind,
  icon,
  label,
  onSelect,
}: {
  context: ManagementCommandContext & { sessionId: string };
  sessionLabel: string;
  admission: AdmissionListItemDto;
  kind: FinanceDialogSelection['kind'];
  icon: Icon;
  label: string;
  onSelect: (selection: FinanceDialogSelection) => void;
}) {
  const financeQuery = useQuery(
    orpc.school.getSessionFinance.queryOptions({
      input: { schoolId: context.schoolId, sessionId: context.sessionId },
    }),
  );
  const config = financeQuery.data?.financeConfig;
  const ready = hasFinanceActionConfig(config);
  const description = financeQuery.isError
    ? 'Finance configuration is unavailable'
    : ready
      ? kind === 'payment'
        ? 'Record a payment for this student'
        : 'Record a billing adjustment'
      : financeQuery.isPending
        ? 'Checking finance configuration…'
        : 'Finance currency and time zone must be configured';
  return (
    <CommandItem
      className={paletteItemClassName}
      value={`student:${admission.id}:${kind}`}
      disabled={!ready || !config}
      onSelect={() => {
        if (!config?.currency || !config.timeZone) return;
        onSelect({
          kind,
          admissionId: admission.id,
          session: {
            id: context.sessionId,
            label: sessionLabel,
            currency: config.currency,
            timeZone: config.timeZone,
            feeElements: Object.entries(config.elements).map(([slug, element]) => ({
              slug,
              name: element.name,
            })),
          },
        });
      }}
    >
      <CommandRow icon={icon} label={label} description={description} />
    </CommandItem>
  );
}

function StudentResultActions({
  context,
  admission,
  navigate,
}: {
  context: ManagementCommandContext & { sessionId: string };
  admission: AdmissionListItemDto;
  navigate: (href: string) => Promise<void>;
}) {
  const placement = admission.placement;
  if (!placement?.classId) return null;
  return (
    <RequirePermissions
      permissions={[
        SCHOOL_ACTIONS.READ_EXAMS,
        SCHOOL_ACTIONS.READ_EXAM_PLANS,
        SCHOOL_ACTIONS.READ_EXAM_RESULTS,
      ].map((action) => ({
        action,
        resource: { kind: 'school' as const, schoolId: context.schoolId },
      }))}
    >
      <AuthorizedStudentResultActions
        context={context}
        admission={admission}
        classId={placement.classId}
        studentId={placement.id}
        navigate={navigate}
      />
    </RequirePermissions>
  );
}

function AuthorizedStudentResultActions({
  context,
  admission,
  classId,
  studentId,
  navigate,
}: {
  context: ManagementCommandContext & { sessionId: string };
  admission: AdmissionListItemDto;
  classId: string;
  studentId: string;
  navigate: (href: string) => Promise<void>;
}) {
  const examsQuery = useAllExams(context.schoolId, context.sessionId);
  const completed = (examsQuery.data ?? []).filter(
    (exam) => exam.status === 'completed',
  );
  const resultsQuery = useQuery({
    queryKey: [
      'management-command-student-results',
      context.schoolId,
      context.sessionId,
      classId,
      studentId,
      completed.map((exam) => exam.slug),
    ],
    enabled: examsQuery.isSuccess && completed.length > 0,
    queryFn: () =>
      mapWithConcurrency(completed, 3, async (exam) => {
        try {
          return {
            exam,
            data: await client.school.getStudentExam({
              schoolId: context.schoolId,
              sessionId: context.sessionId,
              examSlug: exam.slug,
              classId,
              studentId,
            }),
            error: false,
          };
        } catch {
          // One missing plan or unavailable result must not hide other exams.
          return { exam, data: null, error: true };
        }
      }),
  });
  if (examsQuery.isPending) {
    return <ResultProviderStatus label="Checking examinations…" />;
  }
  if (examsQuery.isError) {
    return (
      <ResultProviderStatus
        label="Examinations could not be loaded"
        retry={() => void examsQuery.refetch()}
      />
    );
  }
  if (!completed.length) return null;
  if (resultsQuery.isPending) {
    return <ResultProviderStatus label="Checking available results…" />;
  }
  if (resultsQuery.isError) {
    return (
      <ResultProviderStatus
        label="Results could not be loaded"
        retry={() => void resultsQuery.refetch()}
      />
    );
  }
  const available = resultsQuery.data.filter(
    (entry): entry is typeof entry & { data: NonNullable<typeof entry.data> } =>
      Boolean(entry.data && hasStudentExamResult(entry.data)),
  );
  const hasErrors = resultsQuery.data.some(({ error }) => error);
  if (!available.length) {
    return hasErrors ? (
      <ResultProviderStatus
        label="Some results could not be checked"
        retry={() => void resultsQuery.refetch()}
      />
    ) : null;
  }
  return (
    <>
      <CommandSeparator />
      <CommandGroup heading="Results">
        {available.map(({ exam }) => (
          <CommandItem
            className={paletteItemClassName}
            key={exam.slug}
            value={`student:${admission.id}:result:${exam.slug}`}
            onSelect={() =>
              void navigate(
                `${schoolSessionHref(
                  context.schoolId,
                  context.sessionId,
                  `/exam/${encodeURIComponent(exam.slug)}/classes/${encodeURIComponent(classId)}`,
                )}/students/${encodeURIComponent(studentId)}`,
              )
            }
          >
            <CommandRow
              icon={BookOpenCheck}
              label={`${exam.name} result`}
              description="View the completed examination result"
            />
          </CommandItem>
        ))}
      </CommandGroup>
      {hasErrors ? (
        <ProviderStatus
          heading="Result checks"
          label="Some results could not be checked"
          retry={() => void resultsQuery.refetch()}
        />
      ) : null}
    </>
  );
}

function StudentActions({
  context,
  sessions,
  admission,
  navigate,
  onFinance,
}: {
  context: ManagementCommandContext;
  sessions: SchoolSessionDto[];
  admission: AdmissionListItemDto;
  navigate: (href: string) => Promise<void>;
  onFinance: (selection: FinanceDialogSelection) => void;
}) {
  const session = sessions.find((candidate) => candidate.id === context.sessionId);
  const selectedSessionLabel = session
    ? schoolSessionLabel(session)
    : 'Selected session';
  const baseHref = schoolHref(
    context.schoolId,
    `/admission/${encodeURIComponent(admission.id)}`,
  );
  return (
    <>
      <CommandGroup>
        <RequirePermissions
          permissions={{
            action: SCHOOL_ACTIONS.READ_ADMISSION,
            resource: { kind: 'school', schoolId: context.schoolId },
          }}
        >
          <CommandItem
            className={paletteItemClassName}
            value={`student:${admission.id}:details`}
            onSelect={() => void navigate(`${baseHref}/details`)}
          >
            <CommandRow
              icon={UserRound}
              label="Admission details"
              description="Open the student's admission record"
            />
          </CommandItem>
        </RequirePermissions>
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Billing">
        <RequirePermissions
          permissions={{
            action: SCHOOL_ACTIONS.READ_ADMISSION_LEDGER,
            resource: { kind: 'school', schoolId: context.schoolId },
          }}
        >
          <CommandItem
            className={paletteItemClassName}
            value={`student:${admission.id}:ledger`}
            onSelect={() => void navigate(`${baseHref}/ledger`)}
          >
            <CommandRow
              icon={Landmark}
              label="Open ledger"
              description="Review bills, payments and adjustments"
            />
          </CommandItem>
        </RequirePermissions>
        {context.sessionId ? (
          <>
            <RequirePermissions
              permissions={[
                SCHOOL_ACTIONS.RECORD_PAYMENT,
                SCHOOL_ACTIONS.READ_SESSION_FINANCE,
              ].map((action) => ({
                action,
                resource: { kind: 'school' as const, schoolId: context.schoolId },
              }))}
            >
              <FinanceAction
                context={{ ...context, sessionId: context.sessionId }}
                sessionLabel={selectedSessionLabel}
                admission={admission}
                kind="payment"
                icon={HandCoins}
                label="Record payment"
                onSelect={onFinance}
              />
            </RequirePermissions>
            <RequirePermissions
              permissions={[
                SCHOOL_ACTIONS.RECORD_FINANCE_ADJUSTMENT,
                SCHOOL_ACTIONS.READ_SESSION_FINANCE,
              ].map((action) => ({
                action,
                resource: { kind: 'school' as const, schoolId: context.schoolId },
              }))}
            >
              <FinanceAction
                context={{ ...context, sessionId: context.sessionId }}
                sessionLabel={selectedSessionLabel}
                admission={admission}
                kind="adjustment"
                icon={Percent}
                label="Record adjustment"
                onSelect={onFinance}
              />
            </RequirePermissions>
          </>
        ) : null}
      </CommandGroup>
      {context.sessionId ? (
        <StudentResultActions
          context={{ ...context, sessionId: context.sessionId }}
          admission={admission}
          navigate={navigate}
        />
      ) : null}
    </>
  );
}

export function ManagementCommandPalette({
  open,
  onOpenChange,
  schoolId,
  sessionId,
  sessions,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  sessionId?: string;
  sessions: SchoolSessionDto[];
  onNavigate: (href: string) => void;
}) {
  const context = { schoolId, sessionId } satisfies ManagementCommandContext;
  const form = useForm({
    defaultValues: { query: '' },
    validators: { onChange: querySchema },
  });
  const [remoteQuery, setRemoteQuery] = useState('');
  const [isStudentSearchDebouncing, setIsStudentSearchDebouncing] =
    useState(false);
  const [selectedAdmission, setSelectedAdmission] =
    useState<AdmissionListItemDto>();
  const [financeDialog, setFinanceDialog] =
    useState<FinanceDialogSelection>();
  /** Set once a palette question started an assistant conversation. */
  const [assistantConversationId, setAssistantConversationId] = useState<
    string | null
  >(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commands = createManagementCommandRegistry(context);
  const selectedSession = sessions.find((session) => session.id === sessionId);

  function resetPalette() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    form.reset();
    setRemoteQuery('');
    setIsStudentSearchDebouncing(false);
    setSelectedAdmission(undefined);
    setAssistantConversationId(null);
  }

  function changeOpen(nextOpen: boolean) {
    if (nextOpen && financeDialog) return;
    if (!nextOpen) resetPalette();
    onOpenChange(nextOpen);
  }

  function closeFinanceDialog() {
    onOpenChange(false);
    setFinanceDialog(undefined);
  }

  async function navigate(href: string) {
    if (!(await confirmNavigation())) return;
    changeOpen(false);
    onNavigate(href);
  }

  function changeQuery(value: string, onChange: (value: string) => void) {
    onChange(value);
    if (timer.current) clearTimeout(timer.current);
    setRemoteQuery('');
    const trimmed = value.trim();
    if (!trimmed) {
      setIsStudentSearchDebouncing(false);
      timer.current = undefined;
      return;
    }
    setIsStudentSearchDebouncing(true);
    timer.current = setTimeout(() => {
      setRemoteQuery(trimmed);
      setIsStudentSearchDebouncing(false);
      timer.current = undefined;
    }, 300);
  }

  return (
    <>
      <CommandDialog
        open={open && !financeDialog}
        onOpenChange={changeOpen}
        title="Search CampusPilot"
        description="Search actions and students"
        className="sm:max-w-2xl"
      >
        {assistantConversationId ? (
          <PaletteAssistantView
            schoolId={schoolId}
            conversationId={assistantConversationId}
            onBack={() => setAssistantConversationId(null)}
          />
        ) : (
        <Command
          shouldFilter={false}
          className="p-0 [&_[data-slot=command-input-wrapper]]:border-b [&_[data-slot=command-input-wrapper]]:px-1 [&_[data-slot=command-input-wrapper]]:py-1 [&_[data-slot=input-group]]:h-8! [&_[data-slot=input-group]]:border-0! [&_[data-slot=input-group]]:bg-transparent! [&_[data-slot=input-group]]:shadow-none [&_[data-slot=input-group]]:ring-0!"
        >
          {selectedAdmission ? (
            <div className="flex items-center gap-2.5 border-b px-2 py-2.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Back to search results"
                onClick={() => setSelectedAdmission(undefined)}
              >
                <ChevronLeft aria-hidden />
              </Button>
              <Avatar size="lg">
                <AvatarImage
                  src={getAdmissionPhotoUrl(
                    schoolId,
                    selectedAdmission.id,
                    selectedAdmission.photoS3Key,
                  )}
                  alt=""
                />
                <AvatarFallback>{initials(selectedAdmission.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {selectedAdmission.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {selectedAdmission.admissionNo}
                  {sessionId
                    ? ` · ${selectedSession ? schoolSessionLabel(selectedSession) : 'Selected session'}`
                    : ''}
                </p>
              </div>
            </div>
          ) : (
            <form.Field name="query">
              {(field) => (
                <>
                  <CommandInput
                    autoFocus
                    maxLength={200}
                    value={field.state.value}
                    placeholder="Search actions and students…"
                    onValueChange={(value) =>
                      changeQuery(value, field.handleChange)
                    }
                  />
                  {field.state.meta.errors.length ? (
                    <p
                      className="px-3 py-1 text-xs text-destructive"
                      role="alert"
                    >
                      {field.state.meta.errors
                        .map((error) =>
                          typeof error === 'string' ? error : error?.message,
                        )
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  ) : null}
                </>
              )}
            </form.Field>
          )}
          <CommandList className="max-h-[min(32rem,65vh)] px-0.5 pb-0.5">
            <CommandEmpty>
              {isStudentSearchDebouncing
                ? 'Searching students…'
                : remoteQuery
                  ? 'No matching actions or students.'
                  : 'No actions available.'}
            </CommandEmpty>
            {selectedAdmission ? (
              <StudentActions
                context={context}
                sessions={sessions}
                admission={selectedAdmission}
                navigate={navigate}
                onFinance={(selection) => {
                  setFinanceDialog(selection);
                  changeOpen(false);
                }}
              />
            ) : (
              <form.Subscribe selector={(state) => state.values.query}>
                {(query) => {
                  const navigationCommands = filterManagementCommands(
                    commands,
                    query,
                  );
                  return (
                    <>
                      {navigationCommands.length ? (
                        <CommandGroup
                          heading="Navigation"
                          className="[&:not(:has([data-slot=command-item]))]:hidden"
                        >
                          {navigationCommands.map((command) => {
                            const disabled =
                              command.requiresSession && !sessionId;
                            const item = (
                              <CommandItem
                                className={paletteItemClassName}
                                key={command.id}
                                value={`navigation:${command.id}`}
                                disabled={disabled}
                                onSelect={() =>
                                  void navigate(command.destination(context))
                                }
                              >
                                <CommandRow
                                  icon={command.icon}
                                  label={command.label}
                                  description={
                                    disabled
                                      ? 'Select an academic session first'
                                      : command.description
                                  }
                                />
                              </CommandItem>
                            );
                            return (
                              <Fragment key={command.id}>
                                {command.wrap(item)}
                              </Fragment>
                            );
                          })}
                        </CommandGroup>
                      ) : null}
                      <ExaminationsProvider
                        context={context}
                        query={query}
                        navigate={navigate}
                      />
                      <AdmissionsProvider
                        context={context}
                        query={remoteQuery}
                        onSelect={setSelectedAdmission}
                      />
                      <AskAssistantCommand
                        schoolId={schoolId}
                        query={query}
                        itemClassName={paletteItemClassName}
                        onStarted={setAssistantConversationId}
                      />
                    </>
                  );
                }}
              </form.Subscribe>
            )}
          </CommandList>
          <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
            {selectedAdmission ? 'Choose action' : 'Search actions and students'}
          </div>
        </Command>
        )}
      </CommandDialog>
      {financeDialog?.kind === 'payment' ? (
        <RequirePermissions
          permissions={[
            SCHOOL_ACTIONS.RECORD_PAYMENT,
            SCHOOL_ACTIONS.READ_SESSION_FINANCE,
          ].map((action) => ({
            action,
            resource: { kind: 'school' as const, schoolId },
          }))}
        >
          <PaymentDialog
            schoolId={schoolId}
            admissionId={financeDialog.admissionId}
            sessions={[financeDialog.session]}
            defaultSessionId={financeDialog.session.id}
            onClose={closeFinanceDialog}
          />
        </RequirePermissions>
      ) : financeDialog?.kind === 'adjustment' ? (
        <RequirePermissions
          permissions={[
            SCHOOL_ACTIONS.RECORD_FINANCE_ADJUSTMENT,
            SCHOOL_ACTIONS.READ_SESSION_FINANCE,
          ].map((action) => ({
            action,
            resource: { kind: 'school' as const, schoolId },
          }))}
        >
          <AdjustmentDialog
            schoolId={schoolId}
            admissionId={financeDialog.admissionId}
            sessions={[financeDialog.session]}
            defaultSessionId={financeDialog.session.id}
            onClose={closeFinanceDialog}
          />
        </RequirePermissions>
      ) : null}
    </>
  );
}

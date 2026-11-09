'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import {
  ClipboardCheck,
  FileDown,
  Files,
  MoreVertical,
  Send,
} from 'lucide-react';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@campuspilot/ui/components/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@campuspilot/ui/components/tabs';
import { ExamNavigationLayout } from '@campuspilot/components/exam/exam-navigation-layout';
import type { ExamContextDto } from '@campuspilot/api/routers/school/exam/exam.dto';
import { CLASS_ACTIONS, SCHOOL_ACTIONS, type PermissionCheck } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';
import {
  documentWorkspaceHref,
  documentWorkspacePermissions,
} from '@/components/documents/document-export-link';
import { orpc } from '@/lib/orpc';
import { ExamSession, LoadingExam, Notice, ReadError } from './exam-common';
import {
  canCreateExamReportCards,
  examHref,
  examStatusLabel,
  schoolPermission,
  type ExamScope,
} from './exam-model';
import { ExamActions } from './exam-lifecycle';
import { ExamTimetableMenu } from './exam-timetable';
import { PublishResultsDialog, SendStudentResultDialog } from './exam-result-notifications';
import { confirmNavigation } from '@/lib/navigation-guard';

export function ExamWorkspace({
  scope,
  children,
}: {
  scope: ExamScope;
  children: ReactNode;
}) {
  return (
    <RequirePermissions
      permissions={schoolPermission(scope.schoolId, SCHOOL_ACTIONS.READ_EXAMS)}
      fallback={<Notice>Examination access is unavailable.</Notice>}
    >
      <ExamSession scope={scope}>
        {(active) => (
          <WorkspaceData scope={scope} active={active}>
            {children}
          </WorkspaceData>
        )}
      </ExamSession>
    </RequirePermissions>
  );
}
function WorkspaceData({
  scope,
  active,
  children,
}: {
  scope: ExamScope;
  active: boolean;
  children: ReactNode;
}) {
  const query = useQuery(
    orpc.school.getExamContext.queryOptions({ input: scope }),
  );
  const overview = useQuery(
    orpc.school.getExamOverview.queryOptions({ input: scope }),
  );
  if (query.isPending || overview.isPending) return <LoadingExam />;
  if (!query.data || !overview.data)
    return (
      <ReadError
        error={query.error ?? overview.error}
        retry={() => Promise.all([query.refetch(), overview.refetch()])}
      />
    );
  return (
    <WorkspaceLayout
      scope={scope}
      title={query.data.exam.name}
      overview={overview.data}
      actions={
        <RequirePermissions
          permissions={schoolPermission(
            scope.schoolId,
            SCHOOL_ACTIONS.READ_EXAM_PLANS,
          )}
        >
          <WorkspaceActions
            scope={scope}
            active={active && !query.isError && !overview.isError}
            attendanceEnabled={query.data.attendanceTracking.enabled}
            overview={overview.data}
            context={query.data}
          />
        </RequirePermissions>
      }
    >
      {(query.isError || overview.isError) && (
        <ReadError
          error={query.error ?? overview.error}
          retry={() => Promise.all([query.refetch(), overview.refetch()])}
        />
      )}
      {children}
    </WorkspaceLayout>
  );
}
function WorkspaceActions(
  {
    context,
    ...props
  }: Omit<Parameters<typeof ExamActions>[0], 'totalWorkingDays'> & {
    context: ExamContextDto;
  },
) {
  const pathname = usePathname().replace(/\/$/, '');
  const base = examHref(props.scope, props.scope.examSlug);
  const params = useParams<{ classId?: string; studentId?: string }>();
  const classId =
    typeof params.classId === 'string' ? params.classId : undefined;
  const studentId =
    typeof params.studentId === 'string' ? params.studentId : undefined;
  const query = useQuery(
    orpc.school.getExamAssessmentSettings.queryOptions({ input: props.scope }),
  );
  return (
    <>
      {query.isError ? (
        <ReadError error={query.error} retry={query.refetch} />
      ) : query.data ? (
        <ExamActions
          {...props}
          totalWorkingDays={query.data.totalWorkingDays}
        />
      ) : null}
      {props.overview.planCount > 0 &&
        (pathname === `${base}/timetable` ? (
          <ExamTimetableMenu
            scope={props.scope}
            context={context}
            active={props.active}
          />
        ) : pathname === `${base}/settings` ? null : (
          <ExamDocumentsMenu
            scope={props.scope}
            classId={classId}
            studentId={studentId}
            reportCardsEnabled={canCreateExamReportCards(
              props.overview.status,
            )}
            examStatus={props.overview.status}
          />
        ))}
    </>
  );
}

/**
 * The result notification action of the page, if any: "Publish results" at
 * the examination root (school-wide), "Send result" on a student page
 * (class-scoped, so a teacher only for assigned classes). Class pages have
 * none.
 */
function resultNotificationPermission(scope: ExamScope, classId?: string, studentId?: string): PermissionCheck | null {
  if (!classId && !studentId)
    return { action: SCHOOL_ACTIONS.SEND_NOTIFICATIONS, resource: { kind: 'school', schoolId: scope.schoolId } } as PermissionCheck;
  if (classId && studentId)
    return { action: CLASS_ACTIONS.SEND_RESULT_NOTIFICATION, resource: { kind: 'class', schoolId: scope.schoolId, classId } } as PermissionCheck;
  return null;
}

/**
 * Keeps admit-card, result-document and result-notification permissions
 * independent while sharing one menu. Notification items are lifecycle
 * actions: Publish is enabled only for a completed, unpublished
 * examination; Send result once the examination has started.
 */
function ExamDocumentsMenu({
  scope,
  classId,
  studentId,
  reportCardsEnabled,
  examStatus,
}: {
  scope: ExamScope;
  classId?: string;
  studentId?: string;
  reportCardsEnabled: boolean;
  examStatus: 'ready' | 'active' | 'completed' | null;
}) {
  const ui = useForm({ defaultValues: { dialog: '' as '' | 'publish' | 'send' } });
  const notificationPermission = resultNotificationPermission(scope, classId, studentId);
  const atExamRoot = !classId && !studentId;
  const publication = useQuery({
    ...orpc.school.getExamResultPublication.queryOptions({ input: scope }),
    enabled: atExamRoot,
  });
  const reportCardHref = documentWorkspaceHref({
    scope,
    type: 'report_card',
    examSlug: scope.examSlug,
    classId,
    studentId,
  });
  const admitCardHref = documentWorkspaceHref({
    scope,
    type: 'admit_card',
    examSlug: scope.examSlug,
    classId,
    studentId,
  });
  const admitCardLabel = studentId
    ? 'Download admit card'
    : classId
      ? 'Download class admit cards'
      : 'Download all admit cards';
  const admitCardPermissions = documentWorkspacePermissions(
    scope.schoolId,
    'admit_card',
  );
  const reportCardPermissions = documentWorkspacePermissions(
    scope.schoolId,
    'report_card',
  );
  const notificationPermissions = notificationPermission ? [notificationPermission] : [];
  const permissions = useQuery(
    orpc.authorization.checkPermissions.queryOptions({
      input: {
        permissions: [...admitCardPermissions, ...reportCardPermissions, ...notificationPermissions],
      },
    }),
  );
  if (
    !permissions.data ||
    permissions.isError ||
    permissions.data.results.length !==
      admitCardPermissions.length + reportCardPermissions.length + notificationPermissions.length
  )
    return null;
  const canDownloadAdmitCards = permissions.data.results
    .slice(0, admitCardPermissions.length)
    .every(Boolean);
  const canCreateResults = permissions.data.results
    .slice(admitCardPermissions.length, admitCardPermissions.length + reportCardPermissions.length)
    .every(Boolean);
  const canNotify = notificationPermissions.length > 0 && permissions.data.results.slice(-1)[0] === true;
  // Publication state must be known (and readable) before offering Publish.
  const canPublish = canNotify && atExamRoot && publication.isSuccess;
  const canSendResult = canNotify && !atExamRoot;
  if (!canDownloadAdmitCards && !canCreateResults && !canPublish && !canSendResult) return null;
  const published = publication.data ?? null;
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Examination actions"
        >
          <MoreVertical aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {canDownloadAdmitCards && (
            <DropdownMenuItem asChild>
              <Link href={admitCardHref}>
                <FileDown aria-hidden />
                {admitCardLabel}
              </Link>
            </DropdownMenuItem>
          )}
          {canCreateResults &&
            (reportCardsEnabled ? (
              <DropdownMenuItem asChild>
                <Link href={reportCardHref}>
                  <Files aria-hidden />
                  Create Results
                </Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>
                <Files aria-hidden />
                Create Results
              </DropdownMenuItem>
            ))}
        </DropdownMenuGroup>
        {(canPublish || canSendResult) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {canPublish && (
                <DropdownMenuItem
                  disabled={examStatus !== 'completed' || published !== null}
                  onSelect={() => ui.setFieldValue('dialog', 'publish')}
                >
                  <Send aria-hidden />
                  {published ? 'Results published' : 'Publish results'}
                </DropdownMenuItem>
              )}
              {canSendResult && (
                <DropdownMenuItem
                  disabled={examStatus === null || examStatus === 'ready'}
                  onSelect={() => ui.setFieldValue('dialog', 'send')}
                >
                  <Send aria-hidden />
                  Send result
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    <ui.Subscribe selector={(state) => state.values.dialog}>
      {(dialog) =>
        dialog === 'publish' ? (
          <PublishResultsDialog scope={scope} onClose={() => ui.setFieldValue('dialog', '')} />
        ) : dialog === 'send' && classId && studentId ? (
          <SendStudentResultDialog scope={{ ...scope, classId, studentId }} onClose={() => ui.setFieldValue('dialog', '')} />
        ) : null
      }
    </ui.Subscribe>
    </>
  );
}
function WorkspaceLayout({
  scope,
  title,
  overview,
  actions,
  children,
}: {
  scope: ExamScope;
  title: string;
  overview: {
    planCount: number;
    status: 'ready' | 'active' | 'completed' | null;
    cadetReleasedAt: Date | null;
  };
  actions: ReactNode;
  children: ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const base = examHref(scope, scope.examSlug);
  const section = path.endsWith('/settings') ? 'settings' : path.endsWith('/timetable') ? 'timetable' : 'results';
  const items = [
    {
      id: 'results',
      label: 'Results',
      href: base,
      action: SCHOOL_ACTIONS.READ_EXAM_PLANS,
    },
    ...(overview.planCount > 0
      ? [
          {
            id: 'timetable',
            label: 'Timetable',
            href: `${base}/timetable`,
            action: SCHOOL_ACTIONS.READ_EXAM_TIMETABLE,
          },
          {
            id: 'settings', label: 'More',
            href: `${base}/settings`, action: SCHOOL_ACTIONS.READ_EXAM_PLANS,
          },
        ]
      : []),
  ];
  const selected =
    items.find((item) => item.id === section) ??
    items[0]!;
  const heading = (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <ClipboardCheck className="size-5" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="truncate text-xl font-semibold tracking-tight">
          {title}
        </h1>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="w-fit">
            {examStatusLabel(overview.status)}
          </Badge>
          {overview.cadetReleasedAt ? (
            <Badge variant="secondary" className="w-fit">
              Released to Cadet Portal
            </Badge>
          ) : null}
        </div>
      </div>
    </div>
  );
  return (
    <ExamNavigationLayout
      heading={heading}
      actions={actions}
      navigation={
        overview.planCount > 0 ? (
          <Tabs
            value={selected.id}
            onValueChange={async (value) => {
              const item = items.find((item) => item.id === value);
              if (item && await confirmNavigation()) router.push(item.href);
            }}
          >
            <TabsList variant="line" className="h-auto">
              {items.map((item) => (
                <RequirePermissions
                  key={item.id}
                  permissions={schoolPermission(scope.schoolId, item.action)}
                >
                  <TabsTrigger value={item.id} className="h-9 flex-none px-3 text-sm">{item.label}</TabsTrigger>
                </RequirePermissions>
              ))}
            </TabsList>
          </Tabs>
        ) : null
      }
    >
      {children}
    </ExamNavigationLayout>
  );
}

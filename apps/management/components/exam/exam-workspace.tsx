'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileDown,
  Files,
  MoreVertical,
  Settings2,
} from 'lucide-react';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@campuspilot/ui/components/dropdown-menu';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@campuspilot/ui/components/select';
import { ExamNavigationLayout } from '@campuspilot/components/exam/exam-navigation-layout';
import type { ExamContextDto } from '@campuspilot/api/routers/school/exam/exam.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
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
          />
        ))}
    </>
  );
}

/** Keeps admit-card and result permissions independent while sharing one menu. */
function ExamDocumentsMenu({
  scope,
  classId,
  studentId,
  reportCardsEnabled,
}: {
  scope: ExamScope;
  classId?: string;
  studentId?: string;
  reportCardsEnabled: boolean;
}) {
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
  const permissions = useQuery(
    orpc.authorization.checkPermissions.queryOptions({
      input: {
        permissions: [...admitCardPermissions, ...reportCardPermissions],
      },
    }),
  );
  if (
    !permissions.data ||
    permissions.isError ||
    permissions.data.results.length !==
      admitCardPermissions.length + reportCardPermissions.length
  )
    return null;
  const canDownloadAdmitCards = permissions.data.results
    .slice(0, admitCardPermissions.length)
    .every(Boolean);
  const canCreateResults = permissions.data.results
    .slice(admitCardPermissions.length)
    .every(Boolean);
  if (!canDownloadAdmitCards && !canCreateResults) return null;
  return (
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
      </DropdownMenuContent>
    </DropdownMenu>
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
      icon: ClipboardList,
      href: base,
      action: SCHOOL_ACTIONS.READ_EXAM_PLANS,
    },
    ...(overview.planCount > 0
      ? [
          {
            id: 'timetable',
            label: 'Timetable',
            icon: CalendarDays,
            href: `${base}/timetable`,
            action: SCHOOL_ACTIONS.READ_EXAM_TIMETABLE,
          },
          {
            id: 'settings', label: 'Settings', icon: Settings2,
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
        <Badge variant="outline" className="w-fit">
          {examStatusLabel(overview.status)}
        </Badge>
      </div>
    </div>
  );
  return (
    <ExamNavigationLayout
      heading={heading}
      actions={actions}
      navigation={
        overview.planCount > 0
          ? items.map((item) => (
              <RequirePermissions
                key={item.id}
                permissions={schoolPermission(scope.schoolId, item.action)}
              >
                <Button
                  asChild
                  variant={item.id === selected.id ? 'secondary' : 'ghost'}
                  className="justify-start"
                >
                  <Link href={item.href}>
                    <item.icon aria-hidden />
                    {item.label}
                  </Link>
                </Button>
              </RequirePermissions>
            ))
          : null
      }
      mobileNavigation={
        overview.planCount > 0 ? (
          <Select
            value={selected.id}
            onValueChange={async (value) => {
              const item = items.find((item) => item.id === value);
              if (item && await confirmNavigation()) router.push(item.href);
            }}
          >
            <SelectTrigger className="w-full" aria-label="Examination section">
              <SelectValue>
                <selected.icon aria-hidden />
                {selected.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <RequirePermissions
                  key={item.id}
                  permissions={schoolPermission(scope.schoolId, item.action)}
                >
                  <SelectItem value={item.id}>
                    <item.icon aria-hidden />
                    {item.label}
                  </SelectItem>
                </RequirePermissions>
              ))}
            </SelectContent>
          </Select>
        ) : null
      }
    >
      {children}
    </ExamNavigationLayout>
  );
}

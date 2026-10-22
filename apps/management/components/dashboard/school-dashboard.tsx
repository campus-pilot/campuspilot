"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { PermissionCheck } from "@campuspilot/api/routers/authorization/authorization.dto";
import { SCHOOL_ACTIONS } from "@campuspilot/api/routers/authorization/authorization.dto";
import type { DashboardDto } from "@campuspilot/api/routers/school/dashboard/dashboard.dto";
import { formatBasisPoints, formatMinor } from "@campuspilot/components/finance";
import { Badge } from "@campuspilot/ui/components/badge";
import { Button } from "@campuspilot/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@campuspilot/ui/components/card";
import { Skeleton } from "@campuspilot/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bell,
  Check,
  ClipboardCheck,
  CreditCard,
  GraduationCap,
  RotateCcw,
  UserPlus,
  Users,
} from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/lib/orpc";
import { RequirePermissions } from "@/components/require-permissions";
import { schoolHref, schoolSessionHref } from "@/components/school-route";

type SchoolPermissionAction = Extract<
  PermissionCheck,
  { resource: { kind: "school" } }
>["action"];

type DashboardProps = { schoolId: string; sessionId: string };
type CurrencySummary = NonNullable<DashboardDto["billing"]>["currencies"][number];

function PermissionSection({
  action,
  additionalActions = [],
  schoolId,
  children,
}: {
  action: SchoolPermissionAction;
  additionalActions?: readonly SchoolPermissionAction[];
  schoolId: string;
  children: ReactNode;
}) {
  const permissions = [action, ...additionalActions].map(
    (permissionAction) =>
      ({
        action: permissionAction,
        resource: { kind: "school" as const, schoolId },
      }) as PermissionCheck,
  );
  return (
    <RequirePermissions permissions={permissions}>
      {children}
    </RequirePermissions>
  );
}

function primaryCurrency(billing: NonNullable<DashboardDto["billing"]>) {
  return (
    billing.currencies.find(
      ({ currency }) => currency === billing.primaryCurrency,
    ) ?? billing.currencies[0]
  );
}

function ratioPercent(value: string, total: string) {
  const denominator = BigInt(total);
  if (denominator <= BigInt(0)) return 0;
  const numerator = BigInt(value);
  const result = Number((numerator * BigInt(100)) / denominator);
  return Math.max(0, Math.min(100, result));
}

function DashboardLoading() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-32 w-full rounded-lg" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

function DashboardError({ retry }: { retry: () => void }) {
  return (
    <Card className="mx-auto w-full max-w-7xl border-destructive/20">
      <CardHeader>
        <CardTitle>Dashboard unavailable</CardTitle>
        <CardDescription>
          We could not load this session overview. Your other school workspaces
          are still available.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="outline" onClick={retry}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}

function Greeting({ name }: { name?: string | null }) {
  const firstName = name?.trim().split(/\s+/)[0];
  return (
    <header>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Session dashboard
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
        Welcome back{firstName ? `, ${firstName}` : ""}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your most important permitted work is first; broader school detail
        follows below.
      </p>
    </header>
  );
}

function FocusCard({ data, schoolId, sessionId }: DashboardProps & { data: DashboardDto }) {
  const currency = data.billing ? primaryCurrency(data.billing) : undefined;
  const activeExam = data.examinations?.exams.find(
    ({ status, classCount }) => status === "active" && classCount > 0,
  );
  const billingHref = schoolSessionHref(schoolId, sessionId, "/billing");
  const examHref = schoolSessionHref(
    schoolId,
    sessionId,
    activeExam ? `/exam/${encodeURIComponent(activeExam.slug)}` : "/exam",
  );

  if (currency) {
    return (
      <PermissionSection action={SCHOOL_ACTIONS.READ_BILLING_REPORTS} schoolId={schoolId}>
        <Card className="bg-foreground text-background ring-foreground">
          <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-background/10">
                <CreditCard className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-background/65">Session collections</p>
                <h2 className="mt-1 truncate text-xl font-semibold">
                  {formatMinor(currency.netCashMinor, currency.currency)} collected
                </h2>
                <p className="mt-1 text-xs text-background/65">
                  {currency.collectionRateBasisPoints === null
                    ? "No billed amount yet"
                    : `${formatBasisPoints(currency.collectionRateBasisPoints)} realized`}
                  {` · ${formatMinor(currency.dueMinor, currency.currency)} outstanding`}
                </p>
              </div>
            </div>
            <Button asChild type="button" variant="secondary">
              <Link href={billingHref}>
                Review billing <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </PermissionSection>
    );
  }

  if (activeExam) {
    return (
      <PermissionSection action={SCHOOL_ACTIONS.READ_EXAMS} schoolId={schoolId}>
        <Card className="bg-foreground text-background ring-foreground">
          <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-background/10">
                <ClipboardCheck className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-background/65">Examination work</p>
                <h2 className="mt-1 text-xl font-semibold">
                  {activeExam.name} is active in {activeExam.classCount}{" "}
                  {data.examinations?.scope === "assigned" ? "assigned " : ""}
                  {activeExam.classCount === 1 ? "class" : "classes"}
                </h2>
                <p className="mt-1 text-xs text-background/65">
                  {activeExam.planCount} subject {activeExam.planCount === 1 ? "plan" : "plans"} open for this scope.
                </p>
              </div>
            </div>
            <Button asChild type="button" variant="secondary">
              <Link href={examHref}>
                Open examination <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </PermissionSection>
    );
  }

  return (
    <Card className="bg-foreground text-background ring-foreground">
      <CardContent className="flex items-center gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
          <Check className="size-5" aria-hidden />
        </span>
        <div>
          <p className="text-xs text-background/65">Current priority</p>
          <h2 className="mt-1 text-xl font-semibold">All done for now</h2>
          <p className="mt-1 text-xs text-background/65">
            Nothing currently needs attention in the areas available to you.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof CreditCard;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-xl font-semibold tabular-nums">{value}</p>
          <p className="truncate text-[11px] text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewMetrics({ data, schoolId }: { data: DashboardDto; schoolId: string }) {
  const currency = data.billing ? primaryCurrency(data.billing) : undefined;
  return (
    <section className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
      {currency ? (
        <PermissionSection action={SCHOOL_ACTIONS.READ_BILLING_REPORTS} schoolId={schoolId}>
          <MetricCard
            icon={CreditCard}
            label="Collected"
            value={formatMinor(currency.netCashMinor, currency.currency)}
            detail={
              currency.collectionRateBasisPoints === null
                ? "No billed amount yet"
                : `${formatBasisPoints(currency.collectionRateBasisPoints)} of billed fees`
            }
          />
        </PermissionSection>
      ) : null}
      {data.admissions ? (
        <PermissionSection action={SCHOOL_ACTIONS.LIST_ADMISSIONS} schoolId={schoolId}>
          <MetricCard
            icon={UserPlus}
            label="Admissions"
            value={String(data.admissions.total)}
            detail={`${data.admissions.registered} currently registered`}
          />
        </PermissionSection>
      ) : null}
      {data.classrooms ? (
        <PermissionSection action={SCHOOL_ACTIONS.LIST_CLASSES} additionalActions={[SCHOOL_ACTIONS.LIST_STUDENTS]} schoolId={schoolId}>
          <MetricCard
            icon={Users}
            label={data.classrooms.scope === "assigned" ? "My students" : "Students"}
            value={String(data.classrooms.studentCount)}
            detail={`${data.classrooms.classCount} ${data.classrooms.scope === "assigned" ? "assigned " : ""}${data.classrooms.classCount === 1 ? "class" : "classes"}`}
          />
        </PermissionSection>
      ) : null}
    </section>
  );
}

function DomainRow({
  icon: Icon,
  label,
  status,
  primary,
  context,
  href,
}: {
  icon: typeof CreditCard;
  label: string;
  status: string;
  primary: string;
  context: string;
  href: string;
}) {
  return (
    <div className="grid items-center gap-3 border-t px-4 py-3 first:border-t-0 sm:grid-cols-[1.1fr_.7fr_1fr_1.2fr_auto]">
      <span className="flex items-center gap-2 font-medium">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        {label}
      </span>
      <Badge variant="outline" className="w-fit">{status}</Badge>
      <span className="font-medium tabular-nums">{primary}</span>
      <span className="text-muted-foreground">{context}</span>
      <Button asChild type="button" variant="ghost" size="sm">
        <Link href={href}>Open <ArrowRight aria-hidden /></Link>
      </Button>
    </div>
  );
}

function CrossDomainStatus({ data, schoolId, sessionId }: DashboardProps & { data: DashboardDto }) {
  const currency = data.billing ? primaryCurrency(data.billing) : undefined;
  const activeExam = data.examinations?.exams.find(({ status }) => status === "active");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cross-domain status</CardTitle>
        <CardDescription>
          A compact view of every school area available to your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {data.admissions ? (
          <PermissionSection action={SCHOOL_ACTIONS.LIST_ADMISSIONS} schoolId={schoolId}>
            <DomainRow
              icon={UserPlus}
              label="Admissions"
              status={data.admissions.registered > 0 ? "Active" : "Empty"}
              primary={`${data.admissions.registered} registered`}
              context={`${data.admissions.unassigned} without a preferred class`}
              href={schoolHref(schoolId, "/admission")}
            />
          </PermissionSection>
        ) : null}
        {data.classrooms ? (
          <PermissionSection action={SCHOOL_ACTIONS.LIST_CLASSES} additionalActions={[SCHOOL_ACTIONS.LIST_STUDENTS]} schoolId={schoolId}>
            <DomainRow
              icon={GraduationCap}
              label={data.classrooms.scope === "assigned" ? "My classrooms" : "Classrooms"}
              status={data.classrooms.scope === "assigned" ? "Assigned" : "School"}
              primary={`${data.classrooms.studentCount} students`}
              context={`${data.classrooms.classCount} classes · ${data.classrooms.sectionCount} sections`}
              href={schoolSessionHref(schoolId, sessionId, "/classroom")}
            />
          </PermissionSection>
        ) : null}
        {currency ? (
          <PermissionSection action={SCHOOL_ACTIONS.READ_BILLING_REPORTS} schoolId={schoolId}>
            <DomainRow
              icon={CreditCard}
              label="Billing"
              status="Session"
              primary={`${formatMinor(currency.netCashMinor, currency.currency)} collected`}
              context={`${formatMinor(currency.dueMinor, currency.currency)} outstanding${data.billing && data.billing.currencies.length > 1 ? ` · ${data.billing.currencies.length} currencies` : ""}`}
              href={schoolSessionHref(schoolId, sessionId, "/billing")}
            />
          </PermissionSection>
        ) : null}
        {data.examinations ? (
          <PermissionSection action={SCHOOL_ACTIONS.READ_EXAMS} schoolId={schoolId}>
            <DomainRow
              icon={ClipboardCheck}
              label="Examinations"
              status={activeExam ? "Active" : data.examinations.completed > 0 ? "Completed" : "Ready"}
              primary={activeExam?.name ?? `${data.examinations.configured} configured`}
              context={activeExam ? `${activeExam.classCount} classes · ${activeExam.planCount} plans` : `${data.examinations.completed} completed`}
              href={schoolSessionHref(schoolId, sessionId, "/exam")}
            />
          </PermissionSection>
        ) : null}
      </CardContent>
    </Card>
  );
}

function JobLink({
  icon: Icon,
  label,
  detail,
  href,
}: {
  icon: typeof CreditCard;
  label: string;
  detail: string;
  href: string;
}) {
  return (
    <Button asChild type="button" variant="outline" className="h-auto min-w-0 justify-start gap-3 p-3 text-left">
      <Link href={href}>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{label}</span>
          <span className="block truncate text-[10px] font-normal text-muted-foreground">{detail}</span>
        </span>
      </Link>
    </Button>
  );
}

function CommonJobs({ data, schoolId, sessionId }: DashboardProps & { data: DashboardDto }) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-semibold">Start a common job</h2>
        <p className="text-xs text-muted-foreground">
          Only actions allowed by your current permissions are available.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data.actions.createAdmission ? (
          <PermissionSection
            action={SCHOOL_ACTIONS.CREATE_ADMISSION}
            additionalActions={[
              SCHOOL_ACTIONS.LIST_ADMISSIONS,
              SCHOOL_ACTIONS.LIST_SESSIONS,
              SCHOOL_ACTIONS.LIST_CLASSES,
            ]}
            schoolId={schoolId}
          >
            <JobLink
              icon={UserPlus}
              label="New admission"
              detail="Open admissions"
              href={schoolHref(schoolId, "/admission")}
            />
          </PermissionSection>
        ) : null}
        {data.actions.recordPayment ? (
          <PermissionSection
            action={SCHOOL_ACTIONS.RECORD_PAYMENT}
            additionalActions={[
              SCHOOL_ACTIONS.READ_ADMISSION_LEDGER,
              SCHOOL_ACTIONS.READ_SESSION_FINANCE,
            ]}
            schoolId={schoolId}
          >
            <JobLink
              icon={CreditCard}
              label="Record payment"
              detail="Open session payments"
              href={schoolSessionHref(schoolId, sessionId, "/billing/payments")}
            />
          </PermissionSection>
        ) : null}
        {data.actions.enterResults ? (
          <PermissionSection
            action={SCHOOL_ACTIONS.WRITE_EXAM_RESULTS}
            additionalActions={[SCHOOL_ACTIONS.READ_EXAMS]}
            schoolId={schoolId}
          >
            <JobLink
              icon={ClipboardCheck}
              label="Enter results"
              detail="Open examinations"
              href={schoolSessionHref(schoolId, sessionId, "/exam")}
            />
          </PermissionSection>
        ) : null}
        <Button type="button" variant="outline" disabled className="h-auto min-w-0 justify-start gap-3 p-3 text-left">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
            <Bell className="size-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">Create notice</span>
            <span className="block truncate text-[10px] font-normal">Feature not ready</span>
          </span>
        </Button>
      </div>
    </section>
  );
}

function SectionCard({
  title,
  description,
  href,
  children,
}: {
  title: string;
  description: string;
  href?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {href ? (
          <CardAction>
            <Button asChild type="button" variant="ghost" size="sm">
              <Link href={href}>Open <ArrowRight aria-hidden /></Link>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function CollectionTrend({ summary, href }: { summary: CurrencySummary; href: string }) {
  const max = summary.monthly.reduce((current, month) => {
    const billed = BigInt(month.billedMinor);
    const collected = BigInt(month.netCashMinor);
    return billed > current ? billed : collected > current ? collected : current;
  }, BigInt(0));
  return (
    <SectionCard
      title="Fee collection trend"
      description={`Monthly billed and net collected amounts in ${summary.currency}`}
      href={href}
    >
      {summary.monthly.length ? (
        <>
          <div className="flex h-52 items-end gap-3 border-b border-dashed sm:gap-5">
            {summary.monthly.map((month) => (
              <div key={month.month} className="flex h-full flex-1 items-end gap-1">
                <div
                  className="min-h-0.5 w-1/2 rounded-t-sm bg-muted"
                  style={{ height: `${ratioPercent(month.billedMinor, max.toString())}%` }}
                  title={`${month.month}: ${formatMinor(month.billedMinor, summary.currency)} billed`}
                />
                <div
                  className="min-h-0.5 w-1/2 rounded-t-sm bg-primary"
                  style={{ height: `${ratioPercent(month.netCashMinor, max.toString())}%` }}
                  title={`${month.month}: ${formatMinor(month.netCashMinor, summary.currency)} collected`}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
            {summary.monthly.map((month) => (
              <span key={month.month}>
                {new Intl.DateTimeFormat(undefined, { month: "short" }).format(
                  new Date(`${month.month}-01T00:00:00Z`),
                )}
              </span>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-muted" />Billed</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-primary" />Net collected</span>
          </div>
        </>
      ) : (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No finance activity has been posted for this session.
        </p>
      )}
    </SectionCard>
  );
}

function BillingPosition({ summary, href }: { summary: CurrencySummary; href: string }) {
  const items = [
    ["Billed", summary.billedMinor],
    ["Net collected", summary.netCashMinor],
    ["Credits", summary.creditAdjustmentMinor],
    ["Outstanding", summary.dueMinor],
  ] as const;
  return (
    <SectionCard
      title="Billing position"
      description={`${summary.billedAdmissions} admissions billed in ${summary.currency}`}
      href={href}
    >
      <div className="grid grid-cols-2 gap-2">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-lg border p-3">
            <p className="text-lg font-semibold tabular-nums">{formatMinor(value, summary.currency)}</p>
            <p className="text-[10px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-[11px]">
          <span className="text-muted-foreground">Collection rate</span>
          <span className="font-medium">
            {summary.collectionRateBasisPoints === null ? "—" : formatBasisPoints(summary.collectionRateBasisPoints)}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${ratioPercent(summary.netCashMinor, summary.billedMinor)}%` }} />
        </div>
      </div>
    </SectionCard>
  );
}

function AdmissionOverview({ admissions, href }: { admissions: NonNullable<DashboardDto["admissions"]>; href: string }) {
  const maximum = Math.max(1, ...admissions.byClass.map(({ value }) => value));
  return (
    <SectionCard title="Admissions" description="Current school-wide admission picture" href={href}>
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Total", admissions.total],
          ["Registered", admissions.registered],
          ["Unregistered", admissions.unregistered],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border p-3">
            <p className="text-xl font-semibold tabular-nums">{value}</p>
            <p className="text-[10px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-x-5 gap-y-3 sm:grid-cols-2">
        {admissions.byClass.slice(0, 8).map((item) => (
          <div key={item.classId}>
            <div className="mb-1 flex justify-between text-[11px]"><span>{item.label}</span><span className="tabular-nums text-muted-foreground">{item.value}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((item.value / maximum) * 100)}%` }} /></div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function ExaminationOverview({ examinations, href }: { examinations: NonNullable<DashboardDto["examinations"]>; href: string }) {
  return (
    <SectionCard
      title="Examinations"
      description={`${examinations.configured} configured for ${examinations.scope === "assigned" ? "assigned classes" : "this session"}`}
      href={href}
    >
      {examinations.exams.length ? (
        <div className="flex flex-col gap-3">
          {examinations.exams.map((exam) => (
            <div key={exam.slug} className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${exam.status === "completed" ? "bg-emerald-500" : exam.status === "active" ? "bg-amber-500" : "bg-muted-foreground/40"}`} />
                <span className="min-w-0 flex-1 truncate font-medium">{exam.name}</span>
                <Badge variant="outline" className="capitalize">{exam.status ?? "Not started"}</Badge>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {exam.classCount} {exam.classCount === 1 ? "class" : "classes"} · {exam.planCount} subject {exam.planCount === 1 ? "plan" : "plans"}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No examinations are available for this classroom scope.
        </p>
      )}
    </SectionCard>
  );
}

function ClassLoad({ classrooms, href }: { classrooms: NonNullable<DashboardDto["classrooms"]>; href: string }) {
  const maximum = Math.max(1, ...classrooms.classes.map(({ studentCount }) => studentCount));
  return (
    <SectionCard
      title="Class load"
      description={classrooms.scope === "assigned" ? "Students and sections in assigned classrooms" : "Students and sections across the school"}
      href={href}
    >
      {classrooms.classes.length ? (
        <div className="flex flex-col divide-y">
          {classrooms.classes.map((item) => (
            <div key={item.id} className="grid grid-cols-[minmax(5rem,8rem)_1fr_3rem_4rem] items-center gap-3 py-2.5">
              <span className="truncate font-medium">{item.label}</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((item.studentCount / maximum) * 100)}%` }} /></div>
              <span className="text-right tabular-nums">{item.studentCount}</span>
              <span className="text-right text-[10px] text-muted-foreground">{item.sectionCount} sec.</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No classrooms are available for this account.
        </p>
      )}
    </SectionCard>
  );
}

function DashboardContent({ data, schoolId, sessionId }: DashboardProps & { data: DashboardDto }) {
  const billingCurrencies = data.billing?.currencies ?? [];
  const billingHref = schoolSessionHref(schoolId, sessionId, "/billing/reports");
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <Greeting name={authClient.useSession().data?.user.name} />
      <FocusCard data={data} schoolId={schoolId} sessionId={sessionId} />
      <OverviewMetrics data={data} schoolId={schoolId} />
      <CrossDomainStatus data={data} schoolId={schoolId} sessionId={sessionId} />
      <CommonJobs data={data} schoolId={schoolId} sessionId={sessionId} />
      {billingCurrencies.length ? (
        <PermissionSection action={SCHOOL_ACTIONS.READ_BILLING_REPORTS} schoolId={schoolId}>
          <div className="flex flex-col gap-5">
            {billingCurrencies.map((summary) => (
              <section key={summary.currency} className="flex flex-col gap-3">
                {billingCurrencies.length > 1 ? (
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold">{summary.currency} billing</h2>
                    {summary.currency === data.billing?.primaryCurrency ? <Badge variant="outline">Session currency</Badge> : null}
                  </div>
                ) : null}
                <div className="grid gap-4 lg:grid-cols-[1.45fr_.75fr]">
                  <CollectionTrend summary={summary} href={billingHref} />
                  <BillingPosition summary={summary} href={schoolSessionHref(schoolId, sessionId, "/billing")} />
                </div>
              </section>
            ))}
          </div>
        </PermissionSection>
      ) : null}
      {data.admissions || data.examinations ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {data.admissions ? (
            <PermissionSection action={SCHOOL_ACTIONS.LIST_ADMISSIONS} schoolId={schoolId}>
              <AdmissionOverview admissions={data.admissions} href={schoolHref(schoolId, "/admission")} />
            </PermissionSection>
          ) : null}
          {data.examinations ? (
            <PermissionSection action={SCHOOL_ACTIONS.READ_EXAMS} schoolId={schoolId}>
              <ExaminationOverview examinations={data.examinations} href={schoolSessionHref(schoolId, sessionId, "/exam")} />
            </PermissionSection>
          ) : null}
        </section>
      ) : null}
      {data.classrooms ? (
        <PermissionSection action={SCHOOL_ACTIONS.LIST_CLASSES} additionalActions={[SCHOOL_ACTIONS.LIST_STUDENTS]} schoolId={schoolId}>
          <ClassLoad classrooms={data.classrooms} href={schoolSessionHref(schoolId, sessionId, "/classroom")} />
        </PermissionSection>
      ) : null}
    </div>
  );
}

export function SchoolDashboard({ schoolId, sessionId }: DashboardProps) {
  const dashboardQuery = useQuery(
    orpc.school.getDashboard.queryOptions({ input: { schoolId, sessionId } }),
  );
  if (dashboardQuery.isPending) return <DashboardLoading />;
  if (dashboardQuery.isError) {
    return <DashboardError retry={() => void dashboardQuery.refetch()} />;
  }
  return (
    <DashboardContent
      data={dashboardQuery.data}
      schoolId={schoolId}
      sessionId={sessionId}
    />
  );
}

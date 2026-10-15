"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShellAlert } from "@campuspilot/components/app-shell";
import { Button } from "@campuspilot/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@campuspilot/ui/components/select";
import {
  BookOpen,
  FileText,
  GraduationCap,
  Layers3,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { orpc } from "@/lib/orpc";
import { SCHOOL_ACTIONS } from "@campuspilot/api/routers/authorization/authorization.dto";
import { RequirePermissions } from "./require-permissions";

type WorkspaceItem = {
  id: string;
  label: string;
  icon: LucideIcon;
};

function closeAlertDialog(closeDialog: () => void) {
  closeDialog();
}

const items: WorkspaceItem[] = [
  { id: "students", label: "Students", icon: UserRound },
  { id: "teachers", label: "Teachers", icon: Users },
  { id: "sections", label: "Sections", icon: Layers3 },
  { id: "subjects", label: "Subjects", icon: BookOpen },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings },
];

export function ClassroomWorkspace({
  children,
  classId,
  schoolId,
  sessionId,
}: {
  children: ReactNode;
  classId: string;
  schoolId: string;
  sessionId: string;
}) {
  return (
    <RequirePermissions
      permissions={[
        SCHOOL_ACTIONS.LIST_CLASSES,
        SCHOOL_ACTIONS.READ_CLASS,
        SCHOOL_ACTIONS.READ_SESSION,
      ].map((action) => ({
        action,
        resource: { kind: "school" as const, schoolId },
      }))}
      fallback={
        <p className="text-sm text-muted-foreground">
          Classroom access is unavailable.
        </p>
      }
    >
      <ClassroomWorkspaceContent
        classId={classId}
        schoolId={schoolId}
        sessionId={sessionId}
      >
        {children}
      </ClassroomWorkspaceContent>
    </RequirePermissions>
  );
}
function ClassroomWorkspaceContent({
  children,
  classId,
  schoolId,
  sessionId,
}: {
  children: ReactNode;
  classId: string;
  schoolId: string;
  sessionId: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const classQuery = useQuery(
    orpc.school.getClass.queryOptions({ input: { schoolId, classId } }),
  );
  const classesQuery = useQuery(
    orpc.school.listClasses.queryOptions({ input: { schoolId, sessionId } }),
  );
  const classSummary = classesQuery.data?.find(({ id }) => id === classId);
  const activeItem =
    items.find(({ id }) => pathname.endsWith(`/${id}`)) ?? items[0]!;
  const baseHref = `/school/${encodeURIComponent(schoolId)}/sessions/${encodeURIComponent(sessionId)}/classroom/${encodeURIComponent(classId)}`;

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-4">
      {classSummary?.teacherCount === 0 ? (
        <AppShellAlert
          slug="class/teacher/not-present"
          message="No teachers are assigned to this classroom."
          actionLabel="Add teachers"
          actionHref={`${baseHref}/teachers`}
          onAction={closeAlertDialog}
        />
      ) : null}
      {classSummary?.subjectCount === 0 ? (
        <AppShellAlert
          slug="class/subject/not-present"
          message="No subjects are configured for this classroom."
          actionLabel="Add subjects"
          actionHref={`${baseHref}/subjects`}
          onAction={closeAlertDialog}
        />
      ) : null}
      {classSummary?.studentCount === 0 ? (
        <AppShellAlert
          slug="class/student/not-present"
          message="No students are assigned to this classroom."
          actionLabel="Add students"
          actionHref={`${baseHref}/students`}
          onAction={closeAlertDialog}
        />
      ) : null}
      <div className="flex items-center gap-3 border-b pb-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <GraduationCap className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Classroom
          </p>
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {classQuery.data?.label ?? "Loading classroom…"}
          </h1>
        </div>
      </div>

      <div className="md:hidden">
        <Select
          value={activeItem.id}
          onValueChange={(value) => router.push(`${baseHref}/${value}`)}
        >
          <SelectTrigger className="w-full" aria-label="Classroom section">
            <SelectValue>
              <activeItem.icon aria-hidden />
              {activeItem.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {items.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                <item.icon aria-hidden />
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex min-w-0 items-start gap-6">
        <aside className="hidden w-52 shrink-0 flex-col gap-1 md:flex">
          {items.map((item) => (
            <Button
              key={item.id}
              asChild
              variant={activeItem.id === item.id ? "secondary" : "ghost"}
              className="justify-start"
            >
              <Link href={`${baseHref}/${item.id}`}>
                <item.icon aria-hidden />
                {item.label}
              </Link>
            </Button>
          ))}
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </section>
  );
}

"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShellAlert } from "@campuspilot/components/app-shell";
import { Button } from "@campuspilot/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@campuspilot/ui/components/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@campuspilot/ui/components/tabs";
import { GraduationCap, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { orpc } from "@/lib/orpc";
import { SCHOOL_ACTIONS } from "@campuspilot/api/routers/authorization/authorization.dto";
import { RequirePermissions } from "./require-permissions";
import { AddTeacherDialog } from "./class-teachers";

type WorkspaceItem = {
  id: string;
  label: string;
};

function closeAlertDialog(closeDialog: () => void) {
  closeDialog();
}

/** Own the picker outside the shell's closing alert dialog so it opens on any classroom section. */
function ClassroomTeacherAlert({ schoolId, classId }: { schoolId: string; classId: string }) {
  const [addOpen, setAddOpen] = useState(false);
  const openPicker = useCallback((closeDialog: () => void) => {
    closeDialog();
    setAddOpen(true);
  }, []);
  const alert = {
    slug: `school/${schoolId}/class/${classId}/teachers-missing`,
    type: "warning" as const,
    message: "No teachers are assigned to this classroom.",
  };

  return (
    <>
      <RequirePermissions
        permissions={{ action: SCHOOL_ACTIONS.UPDATE_MEMBER_ROLES, resource: { kind: "school", schoolId } }}
        fallback={<AppShellAlert {...alert} />}
      >
        <AppShellAlert
          {...alert}
          actionLabel="Add teachers"
          onAction={openPicker}
        />
      </RequirePermissions>
      {addOpen ? <AddTeacherDialog schoolId={schoolId} classId={classId} onClose={() => setAddOpen(false)} /> : null}
    </>
  );
}

const items: WorkspaceItem[] = [
  { id: "students", label: "Students" },
  { id: "teachers", label: "Teachers" },
  { id: "sections", label: "Sections" },
  { id: "subjects", label: "Subjects" },
  { id: "documents", label: "Documents" },
  { id: "settings", label: "Settings" },
];
const primaryItems = items.slice(0, 3);
const overflowItems = items.slice(3);

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
        <ClassroomTeacherAlert schoolId={schoolId} classId={classId} />
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
      <div className="flex items-center gap-3">
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

      <div className="flex min-w-0 items-end gap-1">
        <Tabs
          value={activeItem.id}
          onValueChange={(value) => router.push(`${baseHref}/${value}`)}
          className="min-w-0 flex-1"
        >
          <TabsList variant="line" className="h-auto">
            {primaryItems.map((item) => (
              <TabsTrigger key={item.id} value={item.id} className="h-9 flex-none px-2.5 text-sm sm:px-3">
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant={overflowItems.some(({ id }) => id === activeItem.id) ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label="More classroom sections"
            >
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              {overflowItems.map((item) => (
                <DropdownMenuItem key={item.id} asChild>
                  <Link href={`${baseHref}/${item.id}`}>{item.label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

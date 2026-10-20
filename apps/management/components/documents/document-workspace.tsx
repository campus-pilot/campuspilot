"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "@tanstack/react-form";
import { useQueries } from "@tanstack/react-query";
import { z } from "zod";
import { FilePlus, Files, History } from "lucide-react";
import { AppShellAlert } from "@campuspilot/components/app-shell";
import { WorkspaceNavigationLayout } from "@campuspilot/components/workspace-navigation-layout";
import {
  DocumentKindCards,
  DocumentNotice,
  DocumentPanel,
  documentKinds,
} from "@campuspilot/components/documents/document-controls";
import { Button } from "@campuspilot/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@campuspilot/ui/components/select";
import {
  type AcademicDocumentType,
} from "@campuspilot/api/routers/school/document/document.dto";
import { orpc } from "@/lib/orpc";
import {
  DocumentPermission,
  SCHOOL_ACTIONS,
  type DocumentScope,
} from "./document-common";
import { DocumentGenerator } from "./document-generator";
import { DocumentHistory } from "./document-history";

export type DocumentInitialSelection = {
  documentType?: AcademicDocumentType;
  classId?: string;
  examSlug?: string;
  studentId?: string;
};

export type DocumentSection = "generate" | "history";

const sections = [
  {
    value: "generate",
    label: "Create document",
    icon: FilePlus,
    action: SCHOOL_ACTIONS.GENERATE_DOCUMENTS,
  },
  {
    value: "history",
    label: "Document history",
    icon: History,
    action: SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS,
  },
] as const;

/** Settings slugs are existing product vocabulary, not a transformation of the
 * API enum. Keep this mapping exhaustive when adding a document type.
 */
const templateSettingsSlugs: Record<AcademicDocumentType, string> = {
  report_card: "examination",
  id_card: "id-card",
  admit_card: "admit-card",
  timetable: "timetable",
};

function closeAlertDialog(closeDialog: () => void) {
  closeDialog();
}

/** Operational document pages only create and retrieve PDFs. Template selection
 * and editing remain school-level configuration under Settings.
 */
export function DocumentWorkspace({
  scope,
  initial = {},
  section = "generate",
}: {
  scope: DocumentScope;
  initial?: DocumentInitialSelection;
  section?: DocumentSection;
}) {
  return (
    <DocumentPermission
      schoolId={scope.schoolId}
      action={SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES}
      fallback={
        <DocumentNotice>
          Document access is unavailable for your account.
        </DocumentNotice>
      }
    >
      <DocumentWorkspaceContent
        scope={scope}
        initial={initial}
        section={section}
      />
    </DocumentPermission>
  );
}

/** Registers one school-scoped setup condition. The permission-gated
 * registration deliberately reuses the same slug so editors receive an action
 * without viewers seeing a duplicate alert.
 */
function DocumentTemplateAlerts({ schoolId }: { schoolId: string }) {
  const templateQueries = useQueries({
    queries: documentKinds.map(({ value }) =>
      orpc.school.getActiveDocumentTemplate.queryOptions({
        input: { schoolId, documentType: value },
      }),
    ),
  });
  if (templateQueries.some((query) => query.isPending || query.isError))
    return null;

  const missing = documentKinds.filter(
    (_, index) => !templateQueries[index]?.data,
  );
  if (!missing.length) return null;

  const first = missing[0]!;
  const message =
    missing.length === 1
      ? `${first.label} do not have a school template yet.`
      : `${missing.length} document types do not have a school template yet.`;

  const slug = `school/${schoolId}/documents/templates-missing`;
  const alertMessage = `${message} Configure templates before creating those PDFs.`;
  return (
    <>
      <AppShellAlert slug={slug} type="warning" message={alertMessage} />
      <DocumentPermission
        schoolId={schoolId}
        action={SCHOOL_ACTIONS.MANAGE_DOCUMENT_TEMPLATES}
      >
        <AppShellAlert
          slug={slug}
          type="warning"
          message={alertMessage}
          actionLabel="Configure templates"
          actionHref={`/school/${encodeURIComponent(schoolId)}/settings/templates/${templateSettingsSlugs[first.value]}`}
          onAction={closeAlertDialog}
        />
      </DocumentPermission>
    </>
  );
}

function DocumentWorkspaceContent({
  scope,
  initial,
  section,
}: {
  scope: DocumentScope;
  initial: DocumentInitialSelection;
  section: DocumentSection;
}) {
  const router = useRouter();
  const form = useForm({
    defaultValues: {
      documentType: initial.documentType ?? ("report_card" as AcademicDocumentType),
    },
    validators: { onChange: z.object({ documentType: z.enum(["report_card", "id_card", "admit_card", "timetable"]) }) },
  });
  const href = (target: DocumentSection, type: AcademicDocumentType) => {
    const query = new URLSearchParams({
      ...(target === "generate" ? { type } : {}),
      ...(initial.classId ? { classId: initial.classId } : {}),
      ...(initial.examSlug ? { examSlug: initial.examSlug } : {}),
      ...(initial.studentId ? { studentId: initial.studentId } : {}),
    });
    const suffix = target === "generate" ? "" : `/${target}`;
    const serialized = query.toString();
    return `/school/${encodeURIComponent(scope.schoolId)}/sessions/${encodeURIComponent(scope.sessionId)}/documents${suffix}${serialized ? `?${serialized}` : ""}`;
  };

  return (
    <form.Subscribe selector={(state) => state.values.documentType}>
      {(documentType) => {
        const navigate = (target: DocumentSection) =>
          router.push(href(target, documentType));
        const active = sections.find((item) => item.value === section)!;
        return (
          <>
            <DocumentTemplateAlerts schoolId={scope.schoolId} />
            <WorkspaceNavigationLayout
              heading={
                <div className="flex min-w-0 items-center gap-3">
                  <Files className="size-5 shrink-0 text-muted-foreground" />
                  <h1 className="text-xl font-semibold">Documents</h1>
                </div>
              }
              actions={null}
              navigationLabel="Document sections"
              navigation={sections.map((item) => (
                <DocumentPermission
                  key={item.value}
                  schoolId={scope.schoolId}
                  action={item.action}
                >
                  <Button
                    asChild
                    variant={item.value === section ? "secondary" : "ghost"}
                    className="justify-start"
                  >
                    <Link href={href(item.value, documentType)}>
                      <item.icon aria-hidden />
                      {item.label}
                    </Link>
                  </Button>
                </DocumentPermission>
              ))}
              mobileNavigation={
                <Select
                  value={section}
                  onValueChange={(value) => {
                    if (value) navigate(value as DocumentSection);
                  }}
                >
                  <SelectTrigger aria-label="Document section" className="w-full">
                    <SelectValue>
                      <active.icon aria-hidden />
                      {active.label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map((item) => (
                      <DocumentPermission
                        key={item.value}
                        schoolId={scope.schoolId}
                        action={item.action}
                      >
                        <SelectItem value={item.value}>{item.label}</SelectItem>
                      </DocumentPermission>
                    ))}
                  </SelectContent>
                </Select>
              }
            >
              {section === "history" ? (
                <DocumentPermission
                  schoolId={scope.schoolId}
                  action={SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS}
                >
                  <DocumentHistory scope={scope} />
                </DocumentPermission>
              ) : (
                <div className="flex min-w-0 flex-col gap-4">
                  <DocumentPanel
                    title="What would you like to create?"
                    description="Choose a document type, then provide the details needed for that PDF."
                  >
                    <DocumentKindCards
                      value={documentType}
                      onChange={(value) =>
                        form.setFieldValue("documentType", value as AcademicDocumentType)
                      }
                    />
                  </DocumentPanel>
                  <DocumentPermission
                    schoolId={scope.schoolId}
                    action={SCHOOL_ACTIONS.GENERATE_DOCUMENTS}
                    fallback={
                      <DocumentNotice>
                        Creating documents requires additional permission.
                      </DocumentNotice>
                    }
                  >
                    <DocumentGenerator
                      key={documentType}
                      scope={scope}
                      documentType={documentType}
                      initial={initial}
                      onHistory={() => navigate("history")}
                    />
                  </DocumentPermission>
                </div>
              )}
            </WorkspaceNavigationLayout>
          </>
        );
      }}
    </form.Subscribe>
  );
}

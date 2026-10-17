"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { Files, LayoutTemplate, History, FilePlus } from "lucide-react";
import { Button } from "@campuspilot/ui/components/button";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@campuspilot/ui/components/select";
import { WorkspaceNavigationLayout } from "@campuspilot/components/workspace-navigation-layout";
import {
  DocumentNotice,
  DocumentKindPicker,
} from "@campuspilot/components/documents/document-controls";
import {
  documentTypeSchema,
  type DocumentType,
} from "@campuspilot/api/routers/school/document/document.dto";
import { confirmNavigation } from "@/lib/navigation-guard";
import {
  DocumentPermission,
  SCHOOL_ACTIONS,
  type DocumentScope,
} from "./document-common";
import { DocumentGenerator } from "./document-generator";
import { DocumentTemplates } from "./document-templates";
import { DocumentHistory } from "./document-history";
export type DocumentInitialSelection = {
  documentType?: DocumentType;
  classId?: string;
  examSlug?: string;
  studentId?: string;
};
export type DocumentSection = "generate" | "templates" | "history";
const sections = [
  {
    value: "generate",
    label: "Create document",
    icon: FilePlus,
    action: SCHOOL_ACTIONS.GENERATE_DOCUMENTS,
  },
  {
    value: "templates",
    label: "Templates",
    icon: LayoutTemplate,
    action: SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES,
  },
  {
    value: "history",
    label: "Document history",
    icon: History,
    action: SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS,
  },
] as const;
/** Section routes preserve an explicit document type and source selection.
 * App-dialog guard decisions are awaited before leaving a dirty template.
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
      documentType: initial.documentType ?? ("report_card" as DocumentType),
    },
    validators: { onChange: z.object({ documentType: documentTypeSchema }) },
  });
  const href = (target: DocumentSection, type: DocumentType) => {
    const query = new URLSearchParams({
      type,
      ...(initial.classId ? { classId: initial.classId } : {}),
      ...(initial.examSlug ? { examSlug: initial.examSlug } : {}),
      ...(initial.studentId ? { studentId: initial.studentId } : {}),
    });
    return `/school/${encodeURIComponent(scope.schoolId)}/sessions/${encodeURIComponent(scope.sessionId)}/documents${target === "generate" ? "" : `/${target}`}?${query}`;
  };
  return (
    <form.Subscribe selector={(state) => state.values.documentType}>
      {(documentType) => {
        const navigate = async (target: DocumentSection) => {
          if (await confirmNavigation())
            router.push(href(target, documentType));
        };
        const active = sections.find((item) => item.value === section)!;
        return (
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
                  if (value) void navigate(value as DocumentSection);
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
            <div className="flex min-w-0 flex-col gap-4">
              <DocumentKindPicker
                value={documentType}
                onChange={async (value) => {
                  if (value !== documentType && (await confirmNavigation()))
                    form.setFieldValue("documentType", value);
                }}
              />
              <div key={`${documentType}-${section}`}>
                {section === "templates" ? (
                  <DocumentTemplates
                    scope={{ schoolId: scope.schoolId, documentType }}
                  />
                ) : section === "history" ? (
                  <DocumentPermission
                    schoolId={scope.schoolId}
                    action={SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS}
                  >
                    <DocumentHistory
                      scope={scope}
                      documentType={documentType}
                    />
                  </DocumentPermission>
                ) : (
                  <DocumentPermission
                    schoolId={scope.schoolId}
                    action={SCHOOL_ACTIONS.GENERATE_DOCUMENTS}
                    fallback={
                      <DocumentNotice>
                        You can browse templates and document history.
                        Generating documents requires additional permission.
                      </DocumentNotice>
                    }
                  >
                    <DocumentGenerator
                      scope={scope}
                      documentType={documentType}
                      initial={initial}
                      onChooseTemplate={() => void navigate("templates")}
                      onHistory={() => void navigate("history")}
                    />
                  </DocumentPermission>
                )}
              </div>
            </div>
          </WorkspaceNavigationLayout>
        );
      }}
    </form.Subscribe>
  );
}

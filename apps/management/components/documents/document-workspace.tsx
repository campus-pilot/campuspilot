"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "@tanstack/react-form";
import { useQueries, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { FilePlus, Files, History } from "lucide-react";
import { AppShellAlert } from "@campuspilot/components/app-shell";
import { WorkspaceNavigationLayout } from "@campuspilot/components/workspace-navigation-layout";
import {
  DocumentKindCards,
  DocumentNotice,
  DocumentPanel,
  workspaceDocumentKinds,
} from "@campuspilot/components/documents/document-controls";
import { Button } from "@campuspilot/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@campuspilot/ui/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@campuspilot/ui/components/select";
import {
  type AcademicDocumentType,
  type DocumentType,
} from "@campuspilot/api/routers/school/document/document.dto";
import { orpc } from "@/lib/orpc";
import { RequirePermissions } from "@/components/require-permissions";
import {
  DocumentLoading,
  SCHOOL_ACTIONS,
  type DocumentScope,
} from "./document-common";
import { DocumentGenerator } from "./document-generator";
import { FinanceDocumentGenerator } from "./finance-document-generator";
import { DocumentHistory } from "./document-history";

export type DocumentInitialSelection = {
  documentType?: Exclude<DocumentType, "statement">;
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
  },
  {
    value: "history",
    label: "Document history",
    icon: History,
  },
] as const;

/** Settings slugs are existing product vocabulary, not a transformation of the
 * API enum. Keep this mapping exhaustive when adding a document type.
 */
const templateSettingsSlugs: Record<Exclude<DocumentType, "statement">, string> = {
  report_card: "examination",
  id_card: "id-card",
  admit_card: "admit-card",
  timetable: "timetable",
  bill: "bill",
  receipt: "receipt",
};

const documentCreateTitles: Record<Exclude<DocumentType, "statement">, string> = {
  report_card: "Create report cards",
  id_card: "Create student IDs",
  admit_card: "Create admit cards",
  timetable: "Create exam timetables",
  bill: "Create bills",
  receipt: "Create receipts",
};

/** Contextual source values belong to the document type named by the link.
 * Reopening another card must start a clean workflow rather than borrowing them.
 */
function initialForDocumentType(
  documentType: AcademicDocumentType,
  initial: DocumentInitialSelection,
) {
  return documentType === initial.documentType ? initial : {};
}

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
  const resource = { kind: "school" as const, schoolId: scope.schoolId };
  return (
    <RequirePermissions
      mode="any"
      permissions={[
        SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES,
        SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES,
        SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS,
        SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_ARTIFACTS,
      ].map((action) => ({ action, resource }))}
      fallback={
        <DocumentNotice>
          Document access is unavailable for your account.
        </DocumentNotice>
      }
    >
      <DocumentWorkspaceAccess scope={scope} initial={initial} section={section} />
    </RequirePermissions>
  );
}

type DocumentAccess = {
  academicTemplates: boolean;
  financeTemplates: boolean;
  academicHistory: boolean;
  financeHistory: boolean;
};

function DocumentWorkspaceAccess({
  scope,
  initial,
  section,
}: {
  scope: DocumentScope;
  initial: DocumentInitialSelection;
  section: DocumentSection;
}) {
  const resource = { kind: "school" as const, schoolId: scope.schoolId };
  const actions = [
    SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES,
    SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES,
    SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS,
    SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_ARTIFACTS,
  ] as const;
  const permissions = useQuery(
    orpc.authorization.checkPermissions.queryOptions({
      input: { permissions: actions.map((action) => ({ action, resource })) },
    }),
  );
  if (permissions.isPending) return <DocumentLoading />;
  if (permissions.isError || permissions.data.results.length !== actions.length)
    return <DocumentNotice>Document access could not be checked.</DocumentNotice>;
  const [
    academicTemplates,
    financeTemplates,
    academicHistory,
    financeHistory,
  ] = permissions.data.results;
  return (
    <DocumentWorkspaceContent
      scope={scope}
      initial={initial}
      section={section}
      access={{
        academicTemplates: Boolean(academicTemplates),
        financeTemplates: Boolean(financeTemplates),
        academicHistory: Boolean(academicHistory),
        financeHistory: Boolean(financeHistory),
      }}
    />
  );
}

/** Registers one school-scoped setup condition. The permission-gated
 * registration deliberately reuses the same slug so editors receive an action
 * without viewers seeing a duplicate alert.
 */
function DocumentTemplateAlerts({
  schoolId,
  access,
}: {
  schoolId: string;
  access: DocumentAccess;
}) {
  const academicKinds = workspaceDocumentKinds.filter(
    ({ value }) => value !== "bill" && value !== "receipt",
  );
  const financeKinds = workspaceDocumentKinds.filter(
    ({ value }) => value === "bill" || value === "receipt",
  );
  return (
    <>
      {access.academicTemplates ? (
        <DocumentTemplateDomainAlert
          schoolId={schoolId}
          domain="academic"
          kinds={academicKinds}
          manageAction={SCHOOL_ACTIONS.MANAGE_DOCUMENT_TEMPLATES}
        />
      ) : null}
      {access.financeTemplates ? (
        <DocumentTemplateDomainAlert
          schoolId={schoolId}
          domain="finance"
          kinds={financeKinds}
          manageAction={SCHOOL_ACTIONS.MANAGE_FINANCE_DOCUMENT_TEMPLATES}
        />
      ) : null}
    </>
  );
}

type WorkspaceDocumentKind = (typeof workspaceDocumentKinds)[number];

function DocumentTemplateDomainAlert({
  schoolId,
  domain,
  kinds,
  manageAction,
}: {
  schoolId: string;
  domain: "academic" | "finance";
  kinds: readonly WorkspaceDocumentKind[];
  manageAction:
    | typeof SCHOOL_ACTIONS.MANAGE_DOCUMENT_TEMPLATES
    | typeof SCHOOL_ACTIONS.MANAGE_FINANCE_DOCUMENT_TEMPLATES;
}) {
  const templateQueries = useQueries({
    queries: kinds.map(({ value }) =>
      orpc.school.getActiveDocumentTemplate.queryOptions({
        input: { schoolId, documentType: value },
      }),
    ),
  });
  if (templateQueries.some((query) => query.isPending || query.isError))
    return null;

  const missing = kinds.filter(
    (_, index) => !templateQueries[index]?.data,
  );
  if (!missing.length) return null;

  const first = missing[0]!;
  const message =
    missing.length === 1
      ? `${first.label} do not have a school template yet.`
      : `${missing.length} document types do not have a school template yet.`;

  const slug = `school/${schoolId}/documents/${domain}-templates-missing`;
  const alertMessage = `${message} Configure templates before creating those PDFs.`;
  return (
    <>
      <AppShellAlert slug={slug} type="warning" message={alertMessage} />
      <RequirePermissions
        permissions={{
          action: manageAction,
          resource: { kind: "school", schoolId },
        }}
      >
        <AppShellAlert
          slug={slug}
          type="warning"
          message={alertMessage}
          actionLabel="Configure templates"
          actionHref={`/school/${encodeURIComponent(schoolId)}/settings/templates/${templateSettingsSlugs[first.value]}`}
          onAction={closeAlertDialog}
        />
      </RequirePermissions>
    </>
  );
}

function DocumentWorkspaceContent({
  scope,
  initial,
  section,
  access,
}: {
  scope: DocumentScope;
  initial: DocumentInitialSelection;
  section: DocumentSection;
  access: DocumentAccess;
}) {
  const router = useRouter();
  const form = useForm({
    defaultValues: {
      documentType:
        initial.documentType ??
        ("" as Exclude<DocumentType, "statement"> | ""),
    },
    validators: {
      onChange: z.object({
        documentType: z.union([
          z.literal(""),
          z.enum([
            "report_card",
            "id_card",
            "admit_card",
            "timetable",
            "bill",
            "receipt",
          ]),
        ]),
      }),
    },
  });
  const createHref = `/school/${encodeURIComponent(scope.schoolId)}/sessions/${encodeURIComponent(scope.sessionId)}/documents`;
  const href = (
    target: DocumentSection,
    type?: Exclude<DocumentType, "statement">,
  ) => {
    const query = new URLSearchParams({
      ...(target === "generate" && type ? { type } : {}),
      ...(initial.classId ? { classId: initial.classId } : {}),
      ...(initial.examSlug ? { examSlug: initial.examSlug } : {}),
      ...(initial.studentId ? { studentId: initial.studentId } : {}),
    });
    const suffix = target === "generate" ? "" : `/${target}`;
    const serialized = query.toString();
    return `${createHref}${suffix}${serialized ? `?${serialized}` : ""}`;
  };

  /** Closing a context-opened dialog also clears its URL contract so refresh
   * and later card launches cannot restore or inherit the old source values.
   */
  const closeDocumentDialog = () => {
    form.setFieldValue("documentType", "");
    if (initial.documentType) router.replace(createHref);
  };

  return (
    <form.Subscribe selector={(state) => state.values.documentType}>
      {(documentType) => {
        const navigate = (target: DocumentSection) =>
          router.push(href(target, documentType || undefined));
        const active = sections.find((item) => item.value === section)!;
        return (
          <>
            <DocumentTemplateAlerts schoolId={scope.schoolId} access={access} />
            <WorkspaceNavigationLayout
              heading={
                <div className="flex min-w-0 items-center gap-3">
                  <Files className="size-5 shrink-0 text-muted-foreground" />
                  <h1 className="text-xl font-semibold">Documents</h1>
                </div>
              }
              actions={null}
              navigationLabel="Document sections"
              navigation={sections.map((item) => {
                const visible =
                  item.value === "generate"
                    ? access.academicTemplates || access.financeTemplates
                    : access.academicHistory || access.financeHistory;
                return visible ? (
                  <Button
                    key={item.value}
                    asChild
                    variant={item.value === section ? "secondary" : "ghost"}
                    className="justify-start"
                  >
                    <Link href={href(item.value, documentType || undefined)}>
                      <item.icon aria-hidden />
                      {item.label}
                    </Link>
                  </Button>
                ) : null;
              })}
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
                    {sections.map((item) => {
                      const visible =
                        item.value === "generate"
                          ? access.academicTemplates || access.financeTemplates
                          : access.academicHistory || access.financeHistory;
                      return visible ? (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ) : null;
                    })}
                  </SelectContent>
                </Select>
              }
            >
              {section === "history" ? (
                access.academicHistory || access.financeHistory ? (
                  <DocumentHistory
                    scope={scope}
                    domains={{
                      academic: access.academicHistory,
                      finance: access.financeHistory,
                    }}
                  />
                ) : (
                  <DocumentNotice>
                    Document history is unavailable for your account.
                  </DocumentNotice>
                )
              ) : (
                access.academicTemplates || access.financeTemplates ? (
                  <DocumentPanel
                    title="What would you like to create?"
                    description="Choose a document type to configure, preview, and create its PDF."
                  >
                    <DocumentKindCards
                      items={workspaceDocumentKinds.filter(({ value }) =>
                        value === "bill" || value === "receipt"
                          ? access.financeTemplates
                          : access.academicTemplates,
                      )}
                      onChange={(value) =>
                        form.setFieldValue(
                          "documentType",
                          value as Exclude<DocumentType, "statement">,
                        )
                      }
                    />
                  </DocumentPanel>
                ) : (
                  <DocumentNotice>
                    Your account can view document history but cannot read
                    document templates. Open Document history to view existing
                    PDFs.
                  </DocumentNotice>
                )
              )}
            </WorkspaceNavigationLayout>
            {section === "generate" && documentType ? (
              <Dialog
                open
                onOpenChange={(open) => {
                  if (!open) closeDocumentDialog();
                }}
              >
                <DialogContent className="flex max-h-[calc(100dvh-1rem)] min-h-0 w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
                  <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
                    <DialogTitle>{documentCreateTitles[documentType]}</DialogTitle>
                    <DialogDescription>
                      Choose the source data, preview the result, and create the
                      PDF.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
                    {documentType === "bill" || documentType === "receipt" ? (
                      <FinanceDocumentGenerator
                        key={documentType}
                        scope={scope}
                        documentType={documentType}
                        onHistory={() => navigate("history")}
                      />
                    ) : (
                      <DocumentGenerator
                        key={documentType}
                        scope={scope}
                        documentType={documentType}
                        initial={initialForDocumentType(documentType, initial)}
                        onHistory={() => navigate("history")}
                      />
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            ) : null}
          </>
        );
      }}
    </form.Subscribe>
  );
}

'use client';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Files, LayoutTemplate, History, WandSparkles } from 'lucide-react';
import {
  DocumentButton,
  DocumentKindPicker,
  DocumentNotice,
} from '@campuspilot/components/documents/document-controls';
import {
  documentTypeSchema,
  type DocumentType,
} from '@campuspilot/api/routers/school/document/document.dto';
import { confirmNavigation } from '@/lib/navigation-guard';
import {
  DocumentPermission,
  SCHOOL_ACTIONS,
  type DocumentScope,
} from './document-common';
import { DocumentTemplates } from './document-templates';
import { DocumentGenerator } from './document-generator';
import { DocumentHistory } from './document-history';
export type DocumentInitialSelection = {
  documentType?: DocumentType;
  classId?: string;
  examSlug?: string;
  studentId?: string;
};
const tabs = [
  { value: 'generate', label: 'Create document', icon: WandSparkles },
  { value: 'templates', label: 'Templates', icon: LayoutTemplate },
  { value: 'history', label: 'Document history', icon: History },
] as const;
export function DocumentWorkspace({
  scope,
  initial = {},
}: {
  scope: DocumentScope;
  initial?: DocumentInitialSelection;
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
      <DocumentWorkspaceContent scope={scope} initial={initial} />
    </DocumentPermission>
  );
}
function DocumentWorkspaceContent({
  scope,
  initial,
}: {
  scope: DocumentScope;
  initial: DocumentInitialSelection;
}) {
  const form = useForm({
    defaultValues: {
      documentType: initial.documentType ?? ('report_card' as DocumentType),
      tab: 'generate',
    },
    validators: {
      onChange: z.object({
        documentType: documentTypeSchema,
        tab: z.enum(['generate', 'templates', 'history']),
      }),
    },
  });
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-12">
      <header className="flex items-start gap-4">
        <span className="rounded-xl border bg-primary/5 p-3 text-primary">
          <Files className="size-6" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Your school’s templates. Your students’ details. Beautiful
            documents, ready to print.
          </p>
        </div>
      </header>
      <form.Subscribe selector={(state) => state.values}>
        {({ documentType, tab }) => (
          <>
            <DocumentKindPicker
              value={documentType}
              onChange={async (value) => {
                if (value !== documentType && await confirmNavigation())
                  form.setFieldValue('documentType', value);
              }}
            />
            <nav
              aria-label="Documents workspace"
              className="flex flex-wrap gap-2 border-b pb-4"
            >
              {tabs.map((item) => (
                <DocumentTab
                  key={item.value}
                  schoolId={scope.schoolId}
                  tab={item.value}
                >
                  <DocumentButton
                    variant={tab === item.value ? 'secondary' : 'ghost'}
                    aria-current={tab === item.value ? 'page' : undefined}
                    onClick={async () => {
                      if (tab !== item.value && await confirmNavigation())
                        form.setFieldValue('tab', item.value);
                    }}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </DocumentButton>
                </DocumentTab>
              ))}
            </nav>
            <div key={`${documentType}-${tab}`}>
              {tab === 'templates' ? (
                <DocumentTemplates
                  scope={{ schoolId: scope.schoolId, documentType }}
                />
              ) : tab === 'history' ? (
                <DocumentPermission
                  schoolId={scope.schoolId}
                  action={SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS}
                >
                  <DocumentHistory scope={scope} documentType={documentType} />
                </DocumentPermission>
              ) : (
                <DocumentPermission
                  schoolId={scope.schoolId}
                  action={SCHOOL_ACTIONS.GENERATE_DOCUMENTS}
                  fallback={
                    <DocumentNotice>
                      You can browse templates and document history. Generating
                      documents requires additional permission.
                    </DocumentNotice>
                  }
                >
                  <DocumentGenerator
                    scope={scope}
                    documentType={documentType}
                    initial={initial}
                    onChooseTemplate={() =>
                      form.setFieldValue('tab', 'templates')
                    }
                    onHistory={() => form.setFieldValue('tab', 'history')}
                  />
                </DocumentPermission>
              )}
            </div>
          </>
        )}
      </form.Subscribe>
    </div>
  );
}
function DocumentTab({
  schoolId,
  tab,
  children,
}: {
  schoolId: string;
  tab: string;
  children: React.ReactNode;
}) {
  const action =
    tab === 'history'
      ? SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS
      : tab === 'generate'
        ? SCHOOL_ACTIONS.GENERATE_DOCUMENTS
        : SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES;
  return (
    <DocumentPermission schoolId={schoolId} action={action}>
      {children}
    </DocumentPermission>
  );
}

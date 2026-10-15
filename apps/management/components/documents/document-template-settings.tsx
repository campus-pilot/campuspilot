'use client';
import {
  DOCUMENT_LABELS,
  type DocumentType,
} from '@campuspilot/api/routers/school/document/document.dto';
import { DocumentNotice } from '@campuspilot/components/documents/document-controls';
import { DocumentTemplates } from './document-templates';
import { DocumentPermission, SCHOOL_ACTIONS } from './document-common';
/** School template settings and session exports share the same school-level
 * selection, marketplace, and editor, so the two entry points cannot diverge.
 */
export function DocumentTemplateSettings({
  schoolId,
  documentType,
}: {
  schoolId: string;
  documentType: DocumentType;
}) {
  return (
    <DocumentPermission
      schoolId={schoolId}
      action={SCHOOL_ACTIONS.READ_DOCUMENT_TEMPLATES}
      fallback={
        <DocumentNotice>
          Template access is unavailable for your account.
        </DocumentNotice>
      }
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-12">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {DOCUMENT_LABELS[documentType]} · Templates
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure your school’s design once and use it across academic
            sessions.
          </p>
        </header>
        <DocumentTemplates
          key={`${schoolId}-${documentType}`}
          scope={{ schoolId, documentType }}
        />
      </div>
    </DocumentPermission>
  );
}

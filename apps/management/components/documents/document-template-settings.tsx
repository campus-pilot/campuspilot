'use client';
import type { DocumentType } from '@campuspilot/api/routers/school/document/document.dto';
import { DocumentNotice } from '@campuspilot/components/documents/document-controls';
import { DocumentTemplates } from './document-templates';
import { DocumentPermission, SCHOOL_ACTIONS } from './document-common';
/** School settings is the only template editing surface. Operational document
 * pages consume the selected revision without exposing configuration controls.
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
        <DocumentTemplates
          key={`${schoolId}-${documentType}`}
          scope={{ schoolId, documentType }}
        />
      </div>
    </DocumentPermission>
  );
}

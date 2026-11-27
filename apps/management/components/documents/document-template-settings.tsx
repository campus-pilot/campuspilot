'use client';
import type { TemplateDocumentType as DocumentType } from '@campuspilot/api/routers/school/document/document.dto';
import { DocumentNotice } from '@campuspilot/components/documents/document-controls';
import { DocumentTemplates } from './document-templates';
import { DocumentPermission, templateReadAction } from './document-common';
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
      action={templateReadAction(documentType)}
      fallback={
        <DocumentNotice>
          Template access is unavailable for your account.
        </DocumentNotice>
      }
    >
      {/* Each state lays itself out: the pages in a centred column, the editor across the window. */}
      <DocumentTemplates
        key={`${schoolId}-${documentType}`}
        scope={{ schoolId, documentType }}
      />
    </DocumentPermission>
  );
}

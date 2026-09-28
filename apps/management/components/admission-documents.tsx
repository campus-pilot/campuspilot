'use client';

import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { AdmissionDocumentsView } from '@campuspilot/components/admission';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@campuspilot/ui/components/skeleton';

import { orpc } from '@/lib/orpc';
import { admissionDocumentDownloadUrl, deleteAdmissionDocument, uploadAdmissionDocument } from '@/lib/admission-document';
import { RequirePermissions } from './require-permissions';

export function AdmissionDocuments({ schoolId, admissionId }: { schoolId: string; admissionId: string }) {
  const queryClient = useQueryClient();
  const admissionQuery = useQuery(orpc.school.getAdmission.queryOptions({ input: { schoolId, admissionId } }));
  const settingsQuery = useQuery(orpc.school.getAdmissionSettings.queryOptions({ input: { schoolId } }));
  if (admissionQuery.isPending || settingsQuery.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (!admissionQuery.data || !settingsQuery.data) return <p className="text-sm text-destructive">Unable to load admission documents.</p>;
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.school.getAdmission.queryKey({ input: { schoolId, admissionId } }) });
  const view = (canEdit: boolean) => <AdmissionDocumentsView configuredTypes={settingsQuery.data.settings.documentTypes} documents={admissionQuery.data.documents} canEdit={canEdit} onUpload={async ({ files, onProgress, ...document }) => {
    try {
      for (const [index, file] of files.entries()) {
        await uploadAdmissionDocument({ schoolId, admissionId, ...document, file, onProgress: (fileProgress) => onProgress(Math.round(((index + fileProgress / 100) / files.length) * 100)) });
      }
    } finally {
      await refresh();
    }
  }} onDelete={async (fileId) => { await deleteAdmissionDocument(schoolId, admissionId, fileId); await refresh(); }} getDownloadHref={(fileId) => admissionDocumentDownloadUrl(schoolId, admissionId, fileId)} />;
  return <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.UPDATE_ADMISSION, resource: { kind: 'school', schoolId } }} fallback={view(false)}>{view(admissionQuery.data.registered)}</RequirePermissions>;
}

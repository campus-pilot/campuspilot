'use client';

import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { AdmissionDocumentSettings as AdmissionDocumentSettingsView } from '@campuspilot/components/admission';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@campuspilot/ui/components/skeleton';

import { client, orpc } from '@/lib/orpc';
import { RequirePermissions } from './require-permissions';

export function AdmissionDocumentSettings({ schoolId }: { schoolId: string }) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(orpc.school.getAdmissionSettings.queryOptions({ input: { schoolId } }));
  if (settingsQuery.isPending) return <Skeleton className="h-80 w-full max-w-3xl rounded-xl" />;
  if (!settingsQuery.data) return <p className="text-sm text-destructive">Unable to load admission document settings.</p>;
  const view = (canEdit: boolean) => <AdmissionDocumentSettingsView
    key={JSON.stringify(settingsQuery.data.settings.documentTypes)}
    documentTypes={settingsQuery.data.settings.documentTypes}
    canEdit={canEdit}
    onSave={async (documentTypes) => {
      await client.school.updateAdmissionSettings({ schoolId, settings: { documentTypes } });
      await queryClient.invalidateQueries({ queryKey: orpc.school.getAdmissionSettings.queryKey({ input: { schoolId } }) });
    }}
  />;
  return <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.UPDATE_ADMISSION_SETTINGS, resource: { kind: 'school', schoolId } }} fallback={view(false)}>{view(true)}</RequirePermissions>;
}

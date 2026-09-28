'use client';

import { AdmissionDocumentSettings as AdmissionDocumentSettingsView } from '@campuspilot/components/admission';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@campuspilot/ui/components/skeleton';

import { client, orpc } from '@/lib/orpc';

export function AdmissionDocumentSettings({ schoolId }: { schoolId: string }) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(orpc.school.getAdmissionSettings.queryOptions({ input: { schoolId } }));
  if (settingsQuery.isPending) return <Skeleton className="h-80 w-full max-w-3xl rounded-xl" />;
  if (!settingsQuery.data) return <p className="text-sm text-destructive">Unable to load admission document settings.</p>;
  return <AdmissionDocumentSettingsView
    key={JSON.stringify(settingsQuery.data.settings.documentTypes)}
    documentTypes={settingsQuery.data.settings.documentTypes}
    canEdit
    onSave={async (documentTypes) => {
      await client.school.updateAdmissionSettings({ schoolId, settings: { documentTypes } });
      await queryClient.invalidateQueries({ queryKey: orpc.school.getAdmissionSettings.queryKey({ input: { schoolId } }) });
    }}
  />;
}

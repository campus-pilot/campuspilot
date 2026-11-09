'use client';

import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsList, TabsTrigger } from '@campuspilot/ui/components/tabs';
import { ProfileImageEditor } from '@campuspilot/components/profile-image-editor';
import type { AdmissionRecord } from '@campuspilot/components/admission';
import { usePathname, useRouter } from 'next/navigation';

import { orpc } from '@/lib/orpc';
import { AdmissionActions } from './admission-actions';
import { RequirePermissions } from './require-permissions';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { getAdmissionPhotoUrl, uploadAdmissionPhoto } from '@/lib/admission-photo';

type WorkspaceItem = { id: string; label: string };
const items: WorkspaceItem[] = [
  { id: 'details', label: 'Details' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'notifications', label: 'Notifications' },
];

/** Sections shown only with their own read permission. */
const itemPermissions: Partial<Record<string, typeof SCHOOL_ACTIONS.READ_ADMISSION_LEDGER | typeof SCHOOL_ACTIONS.READ_NOTIFICATION_LOG>> = {
  ledger: SCHOOL_ACTIONS.READ_ADMISSION_LEDGER,
  notifications: SCHOOL_ACTIONS.READ_NOTIFICATION_LOG,
};

function AdmissionHeaderPhoto({ schoolId, admissionId, admission }: { schoolId: string; admissionId: string; admission: AdmissionRecord }) {
  const queryClient = useQueryClient();
  const imageUrl = getAdmissionPhotoUrl(schoolId, admissionId, admission.photoS3Key);
  const editor = (canEdit: boolean) => (
    <ProfileImageEditor
      compact
      imageUrl={imageUrl}
      name={admission.name}
      subject="student photo"
      label="Photo"
      canEdit={canEdit && admission.registered}
      onUpload={canEdit ? async (file, options) => {
        await uploadAdmissionPhoto(schoolId, admissionId, file, options);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.school.getAdmission.queryKey({ input: { schoolId, admissionId } }) }),
          queryClient.invalidateQueries({ queryKey: orpc.school.listAdmissions.queryKey({ input: { schoolId } }) }),
        ]);
      } : undefined}
    />
  );
  return <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.UPDATE_ADMISSION, resource: { kind: 'school', schoolId } }} fallback={editor(false)}>{editor(true)}</RequirePermissions>;
}

export function AdmissionWorkspace({ children, schoolId, admissionId }: { children: ReactNode; schoolId: string; admissionId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const admissionQuery = useQuery(orpc.school.getAdmission.queryOptions({ input: { schoolId, admissionId } }));
  const activeItem = items.find(({ id }) => pathname.endsWith(`/${id}`)) ?? items[0]!;
  const baseHref = `/school/${encodeURIComponent(schoolId)}/admission/${encodeURIComponent(admissionId)}`;
  const visibleItems = items.map((item) => ({ ...item, permission: itemPermissions[item.id] }));
  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {admissionQuery.data ? <AdmissionHeaderPhoto schoolId={schoolId} admissionId={admissionId} admission={admissionQuery.data} /> : <span className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />}
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Admission</p>
            <h1 className="truncate text-xl font-semibold tracking-tight">{admissionQuery.data?.name ?? 'Loading admission…'}</h1>
            {admissionQuery.data ? <p className="text-xs text-muted-foreground">{admissionQuery.data.admissionNo}</p> : null}
          </div>
        </div>
        {admissionQuery.data ? <AdmissionActions admission={admissionQuery.data} /> : null}
      </div>
      <Tabs value={activeItem.id} onValueChange={(value) => router.push(`${baseHref}/${value}`)}>
        <TabsList variant="line" className="h-auto">
          {visibleItems.map((item) => {
            const trigger = <TabsTrigger key={item.id} value={item.id} className="h-9 flex-none px-3 text-sm">{item.label}</TabsTrigger>;
            return item.permission ? (
              <RequirePermissions key={item.id} permissions={{ action: item.permission, resource: { kind: 'school', schoolId } }}>
                {trigger}
              </RequirePermissions>
            ) : trigger;
          })}
        </TabsList>
      </Tabs>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

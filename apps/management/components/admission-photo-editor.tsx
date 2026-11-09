'use client';

import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { AdmissionRecord } from '@campuspilot/components/admission';
import { ProfileImageEditor } from '@campuspilot/components/profile-image-editor';
import { useQueryClient } from '@tanstack/react-query';

import { getAdmissionPhotoUrl, uploadAdmissionPhoto } from '@/lib/admission-photo';
import { orpc } from '@/lib/orpc';
import { RequirePermissions } from './require-permissions';

/**
 * Compact student photo for admission and student headers. The photo belongs
 * to the admission, so every screen showing it uploads to the same record.
 * Editing needs `UPDATE_ADMISSION` and a registered admission; everyone else
 * sees the photo (or the student's initials) without the upload affordance.
 */
export function AdmissionPhotoEditor({ schoolId, admission }: { schoolId: string; admission: AdmissionRecord }) {
  const queryClient = useQueryClient();
  const admissionId = admission.id;
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

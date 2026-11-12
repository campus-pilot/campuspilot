'use client';

import type { AssistantAttachmentRef } from '@campuspilot/assistant-contract/attachments';

import { assistantAttachmentThumbUrl, deleteAssistantAttachment, uploadAssistantAttachment } from '@/lib/assistant-attachments';
import { prepareUploadFile } from '@/components/question-paper/prepare-upload-file';

/**
 * The composer's image upload (design G9): a HEIC photo is converted to JPEG
 * in the browser where the browser can decode it (Safari), and otherwise goes
 * up as it is for the model to read where its provider can (decision D24); the
 * server then stores it and answers with the attachment and a thumbnail
 * address. The list of images itself is a field of the composer's form.
 */
export function useAssistantAttachmentUpload(schoolId: string) {
  return {
    upload: async (file: File): Promise<{ ref: AssistantAttachmentRef; previewUrl: string | null }> => {
      const prepared = await prepareUploadFile(file);
      const ref = await uploadAssistantAttachment(schoolId, prepared.file);
      return { ref, previewUrl: ref.previewable ? assistantAttachmentThumbUrl(schoolId, ref.id) : null };
    },
    remove: (ref: AssistantAttachmentRef) => deleteAssistantAttachment(schoolId, ref.id),
  };
}

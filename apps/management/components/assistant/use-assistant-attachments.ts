'use client';

import type { AssistantAttachmentRef } from '@campuspilot/assistant-contract/attachments';

import {
  assistantAttachmentThumbUrl,
  deleteAssistantAttachment,
  prepareAssistantAttachment,
  uploadAssistantAttachment,
} from '@/lib/assistant-attachments';
import { prepareUploadFile } from '@/components/question-paper/prepare-upload-file';

/**
 * The composer's attachment upload (design G9), images and PDFs. The file's
 * first bytes decide its kind (`prepareAssistantAttachment`): a HEIC photo is
 * converted to JPEG in the browser where the browser can decode it (Safari),
 * and otherwise goes up as it is for the model to read where its provider can
 * (decision D24); a PDF goes up exactly as picked; any other file is refused
 * before it uploads. The server then decides the kind again from the bytes,
 * stores the file and answers with the attachment. Only an image the server
 * decoded gets a thumbnail address; a document never does (its bytes are not
 * served back to a browser). The list of attachments itself is a field of the
 * composer's form.
 */
export function useAssistantAttachmentUpload(schoolId: string) {
  return {
    upload: async (file: File): Promise<{ ref: AssistantAttachmentRef; previewUrl: string | null }> => {
      const prepared = await prepareAssistantAttachment(file, async (image) => (await prepareUploadFile(image)).file);
      const ref = await uploadAssistantAttachment(schoolId, prepared.file);
      return { ref, previewUrl: ref.kind === 'image' && ref.previewable ? assistantAttachmentThumbUrl(schoolId, ref.id) : null };
    },
    remove: (ref: AssistantAttachmentRef) => deleteAssistantAttachment(schoolId, ref.id),
  };
}

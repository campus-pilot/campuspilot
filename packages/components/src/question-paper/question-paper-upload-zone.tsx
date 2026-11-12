'use client';

import { Dropzone } from '../dropzone';
import { CameraCapture } from '../camera-capture';
import { QUESTION_PAPER_MAX_PAGES, QUESTION_PAPER_UPLOAD_ACCEPT } from './question-paper-model';
import { ImagePlus } from 'lucide-react';

/**
 * Where photos of the question paper are added: choose or drop files, or take
 * a photo with the camera. Type and size checks (and their messages) belong to
 * the caller (`planUploads`).
 */
export function QuestionPaperUploadZone({
  remaining,
  disabledReason,
  onFiles,
  onRejected,
}: {
  /** Free page slots, net of files still uploading. */
  remaining: number;
  /** Why adding is closed, or null/undefined when it is open. */
  disabledReason?: string | null;
  onFiles: (files: File[]) => void;
  /**
   * Files dropped with a type this zone does not take. They are reported apart
   * from `onFiles` so that one drop never asks the caller to count free slots twice.
   */
  onRejected: (files: File[]) => void;
}) {
  const disabled = Boolean(disabledReason) || remaining <= 0;
  return (
    <div className="flex flex-col gap-3">
      <Dropzone
        icon={ImagePlus}
        title="Add photos of the question paper"
        description={
          disabledReason ??
          (remaining <= 0
            ? `This paper already has ${QUESTION_PAPER_MAX_PAGES} pages.`
            : `Drop photos here or click to choose · JPEG, PNG, WebP or HEIC · up to 15 MB each · ${remaining} of ${QUESTION_PAPER_MAX_PAGES} pages left`)
        }
        accept={QUESTION_PAPER_UPLOAD_ACCEPT}
        multiple
        disabled={disabled}
        onFileSelect={onFiles}
        onFilesRejected={onRejected}
      />
      <CameraCapture disabled={disabled} fileName="question-paper-photo.jpg" onCapture={(file) => onFiles([file])} />
    </div>
  );
}

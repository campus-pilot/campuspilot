import type { ReactNode } from 'react';

export type StudentExamRemarkPreviewValue = {
  text: string;
  /** Null when the author's account no longer exists. */
  authorName: string | null;
  updatedAt: Date | string;
};

/**
 * Read-only view of a teacher's remark on one student's examination. While
 * the results are released to the Cadet Portal the remark is locked, says so,
 * and offers no edit actions (`actions` is ignored), matching the server rule.
 */
export function StudentExamRemarkPreview({
  remark,
  released,
  actions,
}: {
  remark: StudentExamRemarkPreviewValue | null;
  released: boolean;
  /** Edit / remove controls, shown only when the caller allows editing and the remark is not released. */
  actions?: ReactNode;
}) {
  return (
    <>
      {remark ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm whitespace-pre-wrap">{remark.text}</p>
          <p className="text-xs text-muted-foreground">
            {remark.authorName ?? 'Former staff member'} ·{' '}
            {new Date(remark.updatedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No remark written yet.</p>
      )}
      {released ? (
        <p className="text-xs text-muted-foreground">Locked while the results are released to the Cadet Portal.</p>
      ) : (
        actions
      )}
    </>
  );
}

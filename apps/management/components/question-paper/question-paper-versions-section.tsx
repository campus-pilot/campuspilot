'use client';

import { toast } from '@campuspilot/ui/lib/toast';
import { VersionList } from '@campuspilot/components/question-paper/version-list';
import { requestErrorMessage, type QuestionPaperScope } from './question-paper-model';
import { useDownloadQuestionPaper, type QuestionPaperDetail } from './use-question-paper-detail';

/** Every saved version, newest first. Versions are immutable: a new one is added, none is edited. */
export function QuestionPaperVersionsSection({
  scope,
  detail,
  selectedVersionNo,
  onPreview,
}: {
  scope: QuestionPaperScope;
  detail: QuestionPaperDetail;
  selectedVersionNo: number | null;
  onPreview: (versionNo: number) => void;
}) {
  const download = useDownloadQuestionPaper();
  return (
    <VersionList
      versions={detail.versions.map((version) => ({
        versionNo: version.versionNo,
        source: version.source,
        createdAt: version.createdAt,
        createdByName: version.createdBy.name,
        totalMarks: version.totalMarks,
        warningCount: version.warningCount,
        isLatest: version.isLatest,
      }))}
      selectedVersionNo={selectedVersionNo}
      downloadingVersionNo={download.isPending ? (download.variables?.versionNo ?? null) : null}
      onPreview={onPreview}
      onDownload={(versionNo) =>
        download.mutate(
          { ...scope, versionNo },
          { onError: (error) => toast.error(requestErrorMessage(error, 'The PDF could not be prepared.')) },
        )
      }
    />
  );
}

import { Button } from '@campuspilot/ui/components/button';
import { Eye } from 'lucide-react';
import { versionSourceLabel, type QuestionPaperVersionSource } from './question-paper-model';
import { VersionDownloadButtons, type VersionDownloadFormat } from './version-download';

export type VersionView = {
  versionNo: number;
  source: QuestionPaperVersionSource;
  createdAt: Date;
  createdByName: string | null;
  /** How many items the sanitiser removed when the version was saved (the API's `warningCount`). */
  warningCount: number;
  isLatest: boolean;
};

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

function VersionRow({
  version,
  selected,
  downloading,
  onPreview,
  onDownload,
}: {
  version: VersionView;
  selected: boolean;
  /** The format of this version being prepared, or null. */
  downloading: VersionDownloadFormat | null;
  onPreview: (versionNo: number) => void;
  onDownload: (versionNo: number, format: VersionDownloadFormat) => void;
}) {
  const parts = [
    versionSourceLabel(version.source),
    DATE_FORMAT.format(version.createdAt),
    version.createdByName,
    version.warningCount > 0 ? `${version.warningCount} ${version.warningCount === 1 ? 'notice' : 'notices'}` : null,
  ].filter(Boolean);
  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 ${selected ? 'border-primary/50 bg-primary/[0.03]' : ''}`}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-medium">
          Version {version.versionNo}
          {version.isLatest ? <span className="ml-2 text-xs font-normal text-muted-foreground">Latest</span> : null}
        </p>
        <p className="text-xs text-muted-foreground">{parts.join(' · ')}</p>
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onPreview(version.versionNo)}>
          <Eye aria-hidden /> Preview
        </Button>
        <VersionDownloadButtons
          size="sm"
          subject={`version ${version.versionNo}`}
          pending={downloading}
          onDownload={(format) => onDownload(version.versionNo, format)}
        />
      </div>
    </li>
  );
}

/** Every saved version, newest first, with preview and download (PDF, or Word from the menu beside it). Versions are never edited, only added. */
export function VersionList({
  versions,
  selectedVersionNo,
  downloading,
  onPreview,
  onDownload,
}: {
  versions: readonly VersionView[];
  selectedVersionNo: number | null;
  /** The version and format being prepared, or null. */
  downloading: { versionNo: number; format: VersionDownloadFormat } | null;
  onPreview: (versionNo: number) => void;
  onDownload: (versionNo: number, format: VersionDownloadFormat) => void;
}) {
  if (versions.length === 0) return <p className="text-sm text-muted-foreground">No version has been saved yet.</p>;
  return (
    <ul className="flex flex-col gap-2" aria-label="Versions">
      {versions.map((version) => (
        <VersionRow
          key={version.versionNo}
          version={version}
          selected={version.versionNo === selectedVersionNo}
          downloading={downloading?.versionNo === version.versionNo ? downloading.format : null}
          onPreview={onPreview}
          onDownload={onDownload}
        />
      ))}
    </ul>
  );
}

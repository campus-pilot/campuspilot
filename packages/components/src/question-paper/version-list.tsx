import { Button } from '@campuspilot/ui/components/button';
import { Download, Eye } from 'lucide-react';
import { formatMarks, versionSourceLabel } from './question-paper-model';

export type VersionView = {
  versionNo: number;
  source: 'ai_job' | 'agent';
  createdAt: Date;
  createdByName: string | null;
  totalMarks: number | null;
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
  downloading: boolean;
  onPreview: (versionNo: number) => void;
  onDownload: (versionNo: number) => void;
}) {
  const parts = [
    versionSourceLabel(version.source),
    DATE_FORMAT.format(version.createdAt),
    version.createdByName,
    version.totalMarks === null ? null : `${formatMarks(version.totalMarks)} marks`,
    version.warningCount > 0 ? `${version.warningCount} warning${version.warningCount === 1 ? '' : 's'}` : null,
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={downloading}
          aria-label={`Download PDF of version ${version.versionNo}`}
          onClick={() => onDownload(version.versionNo)}
        >
          <Download aria-hidden /> PDF
        </Button>
      </div>
    </li>
  );
}

/** Every saved version, newest first, with preview and PDF download. Versions are never edited, only added. */
export function VersionList({
  versions,
  selectedVersionNo,
  downloadingVersionNo,
  onPreview,
  onDownload,
}: {
  versions: readonly VersionView[];
  selectedVersionNo: number | null;
  downloadingVersionNo: number | null;
  onPreview: (versionNo: number) => void;
  onDownload: (versionNo: number) => void;
}) {
  if (versions.length === 0) return <p className="text-sm text-muted-foreground">No version has been saved yet.</p>;
  return (
    <ul className="flex flex-col gap-2" aria-label="Versions">
      {versions.map((version) => (
        <VersionRow
          key={version.versionNo}
          version={version}
          selected={version.versionNo === selectedVersionNo}
          downloading={version.versionNo === downloadingVersionNo}
          onPreview={onPreview}
          onDownload={onDownload}
        />
      ))}
    </ul>
  );
}

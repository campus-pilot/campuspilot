import { Button } from '@campuspilot/ui/components/button';
import { Eye, RotateCcw, X } from 'lucide-react';

/**
 * A saved revision of a school template as the editor's history shows it
 * (the API's `templateRevisionSchema`, with its time as a `Date`).
 */
export type TemplateRevisionView = {
  revisionId: string;
  revisionNo: number;
  name: string;
  createdAt: Date;
  createdByName: string | null;
  /** Imported from this marketplace design; null for a revision saved in the editor. */
  marketplaceSlug: string | null;
  /** The school's selection names it (its own fact, not "the newest"). */
  selected: boolean;
};

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/** "Imported from the marketplace · 12 Nov 2026, 4:05 pm · Asha": how and when it was saved, and by whom. */
export function templateRevisionDetails(revision: TemplateRevisionView): string {
  return [revision.marketplaceSlug ? 'Imported from the marketplace' : 'Saved in the editor', DATE_FORMAT.format(revision.createdAt), revision.createdByName]
    .filter(Boolean)
    .join(' · ');
}

function RevisionRow({ revision, shown, onView }: { revision: TemplateRevisionView; shown: boolean; onView: (revisionId: string) => void }) {
  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 ${shown ? 'border-primary/50 bg-primary/[0.03]' : ''}`}
      aria-current={shown ? 'true' : undefined}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-medium">
          Revision {revision.revisionNo}
          {revision.selected ? <span className="ml-2 text-xs font-normal text-muted-foreground">In use</span> : null}
        </p>
        <p className="break-words text-xs text-muted-foreground">
          {revision.name} · {templateRevisionDetails(revision)}
        </p>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={() => onView(revision.revisionId)}>
        <Eye aria-hidden /> Preview
      </Button>
    </li>
  );
}

/**
 * Every saved revision of a template, newest first, each with a Preview that
 * shows it in the editor's preview (read-only). Revisions are never edited,
 * only added: the question paper studio's version list, for templates.
 */
export function TemplateRevisionList({
  revisions,
  shownRevisionId,
  onView,
}: {
  revisions: readonly TemplateRevisionView[];
  /** The revision on screen now, or null for the working copy. */
  shownRevisionId: string | null;
  onView: (revisionId: string) => void;
}) {
  if (revisions.length === 0) return <p className="text-sm text-muted-foreground">No revision has been saved yet.</p>;
  return (
    <ul className="flex flex-col gap-2" aria-label="Revisions">
      {revisions.map((revision) => (
        <RevisionRow key={revision.revisionId} revision={revision} shown={revision.revisionId === shownRevisionId} onView={onView} />
      ))}
    </ul>
  );
}

/**
 * What is said above an earlier revision's preview: which revision it is,
 * that it is read-only, and the two ways on: Restore (its source becomes the
 * working copy, saved like any edit as a new revision) and back to the
 * working copy. Restore is absent for someone who may not change the template.
 */
export function TemplateRevisionNotice({
  revision,
  onRestore,
  onClose,
}: {
  revision: TemplateRevisionView;
  onRestore?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-medium">
          Revision {revision.revisionNo}
          {revision.selected ? ' (in use)' : ''} · read-only
        </p>
        <p className="break-words text-xs text-muted-foreground">
          {revision.name} · {templateRevisionDetails(revision)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          <X data-icon="inline-start" aria-hidden /> Back to working copy
        </Button>
        {onRestore ? (
          <Button type="button" onClick={onRestore}>
            <RotateCcw data-icon="inline-start" aria-hidden /> Restore
          </Button>
        ) : null}
      </div>
    </div>
  );
}

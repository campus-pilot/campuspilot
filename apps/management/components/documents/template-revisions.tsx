'use client';

import { skipToken, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { History } from 'lucide-react';
import type { TemplateRevision } from '@campuspilot/api/routers/school/document/document.dto';
import { OptionSelect } from '@campuspilot/components/option-select';
import {
  TemplateRevisionList,
  TemplateRevisionNotice,
  type TemplateRevisionView,
} from '@campuspilot/components/documents/template-revisions';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';

import { orpc } from '@/lib/orpc';

import { DocumentReadError, type DocumentTemplateScope } from './document-common';
import { TemplatePdfPreview } from './template-pdf-preview';

/** The select's value for the editor's own working copy (a revision id never looks like this). */
const WORKING_COPY = 'working';

export const revisionViewOf = (revision: TemplateRevision): TemplateRevisionView => ({ ...revision, createdAt: new Date(revision.createdAt) });

/**
 * The revision the preview shows instead of the working copy, from the
 * editor's address (`?revision=<id>`, as the question paper studio keeps
 * `?version=n`), so a reload or a shared link keeps it. Null: the working
 * copy. The id is only a request: the server decides whether this school's
 * template of this type has such a revision.
 */
export function useRevisionParam() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const raw = search.get('revision');
  const revisionId = raw && /^[A-Za-z0-9_-]{1,100}$/.test(raw) ? raw : null;
  const setRevision = (next: string | null) => {
    const query = new URLSearchParams(search.toString());
    if (next) query.set('revision', next);
    else query.delete('revision');
    const suffix = query.toString();
    router.replace(suffix ? `${pathname}?${suffix}` : pathname, { scroll: false });
  };
  return { revisionId, setRevision };
}

/** The newest revisions (one page), for the header's select; the history dialog pages through the rest. */
function useRecentRevisions(scope: DocumentTemplateScope) {
  return useQuery(orpc.school.listDocumentTemplateRevisions.queryOptions({ input: { ...scope, limit: 20 } }));
}

/** One revision with its source. A revision never changes, so it is read once. */
export function useTemplateRevision(scope: DocumentTemplateScope, revisionId: string | null) {
  return useQuery({
    ...orpc.school.getDocumentTemplateRevision.queryOptions({ input: revisionId ? { ...scope, revisionId } : skipToken }),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Which revision is on screen, as the question paper studio's version
 * select: the working copy first (said to be unsaved when it is), then the
 * newest revisions; the one in use is marked. A revision opened from the
 * history that is older than the listed ones is added so the select can
 * name it. Beside it, the history button opens every revision.
 */
export function RevisionPicker({
  scope,
  revisionId,
  shown,
  dirty,
  onChange,
  onOpenHistory,
}: {
  scope: DocumentTemplateScope;
  revisionId: string | null;
  /** The revision on screen when it was read; it names the select's value when it is not among the newest. */
  shown: TemplateRevision | undefined;
  dirty: boolean;
  onChange: (revisionId: string | null) => void;
  onOpenHistory: () => void;
}) {
  const recent = useRecentRevisions(scope);
  const listed = recent.data?.items ?? [];
  const revisions = shown && !listed.some((revision) => revision.revisionId === shown.revisionId) ? [...listed, shown] : listed;
  const options = [
    { value: WORKING_COPY, label: dirty ? 'Working copy (unsaved)' : 'Working copy' },
    ...revisions.map((revision) => ({ value: revision.revisionId, label: `Revision ${revision.revisionNo}${revision.selected ? ' (in use)' : ''}` })),
  ];
  return (
    <div className="flex items-center gap-1">
      <OptionSelect
        value={revisionId && revisions.some((revision) => revision.revisionId === revisionId) ? revisionId : WORKING_COPY}
        options={options}
        onValueChange={(value) => onChange(value === WORKING_COPY ? null : value)}
        triggerProps={{ 'aria-label': 'Revision', className: 'w-52 max-md:min-w-36 max-md:flex-1' }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="All revisions" onClick={onOpenHistory}>
            <History aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>All revisions</TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Every revision, a page at a time (read only while the dialog is open: its list is mounted then). */
function RevisionHistoryList({ scope, shownRevisionId, onView }: { scope: DocumentTemplateScope; shownRevisionId: string | null; onView: (revisionId: string) => void }) {
  const list = useInfiniteQuery(
    orpc.school.listDocumentTemplateRevisions.infiniteOptions({
      input: (page: number) => ({ ...scope, limit: 20, page }),
      initialPageParam: 1,
      getNextPageParam: ({ pagination }) => (pagination.currentPage < pagination.totalPages ? pagination.currentPage + 1 : undefined),
    }),
  );
  // Held pages win over a failed refetch, so the list never blanks under the user.
  if (list.data === undefined) {
    return list.isPending ? <Skeleton className="h-28 w-full rounded-lg" /> : <DocumentReadError error={list.error} retry={list.refetch} />;
  }
  return (
    <div className="flex flex-col gap-2">
      <TemplateRevisionList revisions={list.data.pages.flatMap((page) => page.items.map(revisionViewOf))} shownRevisionId={shownRevisionId} onView={onView} />
      {list.hasNextPage ? (
        <Button type="button" variant="ghost" className="self-center" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          {list.isFetchingNextPage ? 'Loading…' : 'Show older'}
        </Button>
      ) : null}
    </div>
  );
}

/** Every saved revision in a dialog, as the studio's "All versions"; previewing one shows it beside the editor. */
export function RevisionHistoryDialog({
  scope,
  open,
  onOpenChange,
  shownRevisionId,
  onView,
}: {
  scope: DocumentTemplateScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shownRevisionId: string | null;
  onView: (revisionId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Revisions</DialogTitle>
          <DialogDescription>Every save is a new revision. Earlier ones are kept and can be previewed and restored.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60dvh] overflow-y-auto">
          {open ? (
            <RevisionHistoryList
              scope={scope}
              shownRevisionId={shownRevisionId}
              onView={(revisionId) => {
                onOpenChange(false);
                onView(revisionId);
              }}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * An earlier revision in the preview pane: what it is (read-only) above its
 * PDF, with Restore for someone who may change the template. Nothing here
 * is editable: a revision is immutable.
 */
export function RevisionPreview({
  scope,
  revision,
  printSize,
  onRestore,
  onClose,
}: {
  scope: DocumentTemplateScope;
  revision: ReturnType<typeof useTemplateRevision>;
  /** Notice designs only: the print size to preview at (the same choice as the working copy's). */
  printSize: 'full' | 'half';
  onRestore?: (revision: { content: string; pageSize: 'full' | 'half' }) => void;
  onClose: () => void;
}) {
  if (!revision.data) {
    return revision.isError ? <DocumentReadError error={revision.error} retry={revision.refetch} /> : <Skeleton className="h-full w-full rounded-xl" />;
  }
  const { content } = revision.data;
  const { pageSize } = revision.data.revision;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <TemplateRevisionNotice
        revision={revisionViewOf(revision.data.revision)}
        onRestore={onRestore ? () => onRestore({ content, pageSize }) : undefined}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1">
        <TemplatePdfPreview
          scope={scope}
          content={content}
          pageSize={pageSize}
          printSize={printSize}
          label={`Revision ${revision.data.revision.revisionNo} preview`}
        />
      </div>
    </div>
  );
}

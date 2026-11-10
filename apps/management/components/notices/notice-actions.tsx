'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, MoreHorizontal, Pencil, Send, Trash2 } from 'lucide-react';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { NoticeDto } from '@campuspilot/api/routers/school/notice/notice.dto';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { Button } from '@campuspilot/ui/components/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@campuspilot/ui/components/dropdown-menu';
import { toast } from '@campuspilot/ui/lib/toast';

import { client, orpc } from '@/lib/orpc';
import { RequirePermissions } from '../require-permissions';
import { editNoticeHref, noticeActionsFor, noticeErrorMessage, noticesHref } from './notice-model';
import { NoticePublishDialog } from './notice-publish-dialog';

function schoolPermission(schoolId: string, action: typeof SCHOOL_ACTIONS.DRAFT_NOTICE | typeof SCHOOL_ACTIONS.PUBLISH_NOTICE | typeof SCHOOL_ACTIONS.READ_NOTICE) {
  return { action, resource: { kind: 'school' as const, schoolId } };
}

function EditNoticeAction({ notice }: { notice: NoticeDto }) {
  return (
    <RequirePermissions permissions={schoolPermission(notice.schoolId, SCHOOL_ACTIONS.DRAFT_NOTICE)}>
      <Button asChild size="sm" variant="outline">
        <Link href={editNoticeHref(notice, notice.id)}><Pencil aria-hidden />Edit</Link>
      </Button>
    </RequirePermissions>
  );
}

function PublishNoticeAction({ notice }: { notice: NoticeDto }) {
  const [open, setOpen] = useState(false);
  return (
    <RequirePermissions permissions={schoolPermission(notice.schoolId, SCHOOL_ACTIONS.PUBLISH_NOTICE)}>
      <Button type="button" size="sm" onClick={() => setOpen(true)}><Send aria-hidden />Publish</Button>
      {open ? <NoticePublishDialog notice={notice} onClose={() => setOpen(false)} /> : null}
    </RequirePermissions>
  );
}

/** Opens the published notice's PDF through a short-lived download URL. */
function DownloadNoticeAction({ notice }: { notice: NoticeDto }) {
  const download = useMutation({
    mutationFn: () => client.school.getNoticeDownload({ schoolId: notice.schoolId, noticeId: notice.id }),
    onSuccess: ({ url }) => {
      const link = document.createElement('a');
      link.href = url;
      link.rel = 'noopener noreferrer';
      link.click();
    },
    onError: (error) => toast.error(noticeErrorMessage(error, 'The PDF is unavailable.')),
  });
  return (
    <Button type="button" size="sm" variant="outline" disabled={download.isPending} onClick={() => download.mutate()}>
      <Download aria-hidden />{download.isPending ? 'Preparing…' : 'Download PDF'}
    </Button>
  );
}

function useDeleteNotice(notice: NoticeDto) {
  const router = useRouter();
  const cache = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => client.school.deleteNotice({ schoolId: notice.schoolId, noticeId: notice.id }),
    onSuccess: async () => {
      toast.success('Draft deleted.');
      router.push(noticesHref(notice));
      await cache.invalidateQueries({ queryKey: orpc.school.listNotices.key() });
    },
  });
  return { confirming, setConfirming, remove };
}

/** The overflow menu holds the one destructive lifecycle action of a draft. */
function DraftOverflowMenu({ notice }: { notice: NoticeDto }) {
  const { confirming, setConfirming, remove } = useDeleteNotice(notice);
  return (
    <RequirePermissions permissions={schoolPermission(notice.schoolId, SCHOOL_ACTIONS.DRAFT_NOTICE)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="More notice actions"><MoreHorizontal aria-hidden /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onSelect={() => { remove.reset(); setConfirming(true); }}><Trash2 aria-hidden />Delete draft</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmationDialog
        open={confirming}
        title="Delete this draft?"
        description={`"${notice.title}" is deleted for good. It was never published, so nobody was notified.`}
        confirmLabel={remove.isPending ? 'Deleting…' : 'Delete draft'}
        pending={remove.isPending}
        onOpenChange={setConfirming}
        onConfirm={() => remove.mutate()}
      >
        {remove.isError ? <p className="text-sm text-destructive" role="alert">{noticeErrorMessage(remove.error, 'Unable to delete this draft.')}</p> : null}
      </ConfirmationDialog>
    </RequirePermissions>
  );
}

/**
 * Header actions of a notice; see {@link noticeActionsFor} for which apply.
 * A draft offers Edit and Publish with Delete in the overflow menu; a
 * published notice offers only its PDF.
 */
export function NoticeActions({ notice }: { notice: NoticeDto }) {
  const actions = noticeActionsFor(notice);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.edit ? <EditNoticeAction notice={notice} /> : null}
      {actions.publish ? <PublishNoticeAction notice={notice} /> : null}
      {actions.download ? <DownloadNoticeAction notice={notice} /> : null}
      {actions.remove ? <DraftOverflowMenu notice={notice} /> : null}
    </div>
  );
}

'use client';

import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, CircleAlert, Copy, Eye, FileText, TriangleAlert, X } from 'lucide-react';
import { z } from 'zod';
import { CameraCapture } from '@campuspilot/components/camera-capture';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { formatAttachmentSize } from '@campuspilot/components/assistant/assistant-attachments-model';
import { GenerationStatus } from '@campuspilot/components/question-paper/generation-status';
import { PaperSourceItem, PaperSourceTray, type PaperSourceWay } from '@campuspilot/components/question-paper/paper-source-tray';
import { editBlockedReason, QUESTION_PAPER_MAX_PAGES } from '@campuspilot/components/question-paper/question-paper-model';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { toast } from '@campuspilot/ui/lib/toast';
import { cn } from '@campuspilot/ui/lib/utils';
import { deleteAssistantAttachment, uploadAssistantAttachment } from '@/lib/assistant-attachments';
import { orpc } from '@/lib/orpc';
import { questionPaperThumbUrl } from '@/lib/question-paper-pages';
import { EarlierPaperDialog, earlierPaperDetail, earlierPaperTitle } from './earlier-paper-dialog';
import { applyPageOrder, currentJobFailure, inFlightJob, isConflict, requestErrorMessage, uploadsInFlight, type QuestionPaperScope } from './question-paper-model';
import {
  createPlanOf,
  marksMismatchOf,
  noteWordsOf,
  sortSourcePicks,
  START_NOTE_MAX_LENGTH,
  START_SOURCE_ACCEPT,
  type AlternativeSource,
  type CreatePlan,
  type EarlierPaper,
} from './question-paper-start-model';
import { EarlierPaperPreviewDialog, PagePreviewDialog } from './source-preview-dialogs';
import { useStartPaperConversation } from './use-paper-assistant';
import { useRefreshQuestionPaper, type QuestionPaperDetail } from './use-question-paper-detail';
import type { PageUploads } from './use-page-uploads';

const startSchema = z.object({
  note: z.string().max(START_NOTE_MAX_LENGTH, `Keep the note under ${START_NOTE_MAX_LENGTH} characters.`),
  alternative: z.custom<AlternativeSource>(),
});

type StartProps = {
  scope: QuestionPaperScope;
  detail: QuestionPaperDetail;
  canManage: boolean;
  uploads: PageUploads;
  /** The earlier-paper picker is open (it lives in the address, so Back closes it). */
  earlierOpen: boolean;
  onEarlierOpenChange: (open: boolean) => void;
  /** The paper has something to show now: open the studio on this version or conversation. */
  onOpenStudio: (query?: { version?: number; chat?: string }) => void;
  /** Returns to the paper's studio, for a paper that has one (a version, a generation or a conversation); null for a paper made here first. */
  onBack: (() => void) | null;
};

/**
 * Reordering is optimistic: the tray shows the new order at once and the
 * server decides. On any failure the old order returns, and on a conflict
 * (someone else changed the pages) the list is reloaded and says so.
 */
function usePageReorder(scope: QuestionPaperScope) {
  const queryClient = useQueryClient();
  const refresh = useRefreshQuestionPaper(scope);
  const detailKey = orpc.school.getQuestionPaperDetail.queryKey({ input: scope });
  return useMutation(
    orpc.school.reorderQuestionPaperPages.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries({ queryKey: detailKey });
        const before = queryClient.getQueryData(detailKey);
        if (before) queryClient.setQueryData(detailKey, { ...before, pages: applyPageOrder(before.pages, input.pageIds) });
        return { before };
      },
      onError: (error, _input, context) => {
        if (context?.before) queryClient.setQueryData(detailKey, context.before);
        toast.error(isConflict(error) ? 'Someone changed the pages; reloaded.' : requestErrorMessage(error, 'The new order could not be saved.'));
      },
      onSettled: refresh,
    }),
  );
}

function useDeletePage(scope: QuestionPaperScope) {
  const refresh = useRefreshQuestionPaper(scope);
  return useMutation(
    orpc.school.deleteQuestionPaperPage.mutationOptions({
      onError: (error) => toast.error(isConflict(error) ? 'Someone changed the pages; reloaded.' : requestErrorMessage(error, 'The page could not be removed.')),
      onSettled: refresh,
    }),
  );
}

/**
 * The first screen's state and what its one button does.
 *
 * The note and the chosen alternative (a PDF, an earlier paper) are a TanStack
 * form; the photos are the paper's own stored pages and its upload queue. On
 * Create the plan (`createPlanOf`) is carried out: the generation job for
 * photos, a copy for an earlier paper, or the first message of the paper's
 * conversation for a PDF or a description. A failure stays beside the button
 * and nothing in the card is lost.
 */
function usePaperStart({ scope, detail, uploads, onOpenStudio }: Pick<StartProps, 'scope' | 'detail' | 'uploads' | 'onOpenStudio'>) {
  const refresh = useRefreshQuestionPaper(scope);
  const assistant = useStartPaperConversation(scope);
  const generate = useMutation(orpc.school.startQuestionPaperGeneration.mutationOptions());
  const copy = useMutation(orpc.school.copyQuestionPaperVersion.mutationOptions());
  /** Identifies the PDF upload in flight, so one that finishes after its row was removed is discarded. */
  const pdfUpload = useRef<symbol | null>(null);

  const run = useMutation({
    mutationFn: async (plan: Exclude<CreatePlan, { kind: 'blocked' }>) => {
      if (plan.kind === 'generate') {
        await generate.mutateAsync({ ...scope, expectedPageRevision: detail.paper.pageRevision, ...(plan.instructions ? { instructions: plan.instructions } : {}) });
        return {};
      }
      if (plan.kind === 'assistant') return { chat: await assistant.start(plan.message, plan.attachments) };
      const { versionNo } = await copy.mutateAsync({
        ...scope,
        expectedVersionNo: detail.paper.latestVersionNo,
        source: { ...plan.earlier.key, versionNo: plan.earlier.versionNo },
      });
      if (!plan.followUp) return { version: versionNo };
      // The copy is saved either way; a note that could not be sent is said so, and the paper opens without it.
      const chat = await assistant.start(plan.followUp).catch((error: unknown) => {
        toast.error(`The paper was copied, but your note could not be sent. ${requestErrorMessage(error, '')}`.trim());
        return null;
      });
      return chat ? { chat } : { version: versionNo };
    },
    // Success shows the job or the new version; a conflict reloads what changed under the user.
    onSettled: refresh,
  });

  const form = useForm({
    // A generation that failed gives its note back, so trying again does not mean typing it again.
    defaultValues: { note: (currentJobFailure(detail) ? detail.lastFinishedJob?.instructions : null) ?? '', alternative: null as AlternativeSource },
    validators: { onChange: startSchema },
    onSubmit: async ({ value }) => {
      const plan = createPlanOf({
        alternative: value.alternative,
        pageCount: detail.paper.pageCount,
        uploading: uploadsInFlight(uploads.form.getFieldValue('items')) > 0,
        note: value.note,
      });
      if (plan.kind === 'blocked') return;
      const opened = await run.mutateAsync(plan).catch(() => null);
      if (opened) onOpenStudio(opened);
    },
  });

  /** Stores the PDF for the paper's first message. The server decides from the bytes whether it is one. */
  async function addPdf(file: File) {
    const token = Symbol(file.name);
    pdfUpload.current = token;
    const pdf = { fileName: file.name, byteSize: file.size, attachment: null, error: null };
    form.setFieldValue('alternative', { kind: 'pdf', pdf: { ...pdf, status: 'uploading' } });
    try {
      const ref = await uploadAssistantAttachment(scope.schoolId, file);
      const current = pdfUpload.current === token;
      if (!current || ref.kind !== 'document') void deleteAssistantAttachment(scope.schoolId, ref.id).catch(() => undefined);
      if (!current) return;
      form.setFieldValue(
        'alternative',
        ref.kind === 'document'
          ? { kind: 'pdf', pdf: { ...pdf, fileName: ref.fileName, byteSize: ref.byteSize, status: 'ready', attachment: ref } }
          : { kind: 'pdf', pdf: { ...pdf, status: 'failed', error: 'This file is not a PDF.' } },
      );
    } catch (error) {
      if (pdfUpload.current !== token) return;
      form.setFieldValue('alternative', { kind: 'pdf', pdf: { ...pdf, status: 'failed', error: requestErrorMessage(error, 'The PDF could not be uploaded.') } });
    }
  }

  /** Takes the chosen PDF or earlier paper out again; a stored PDF nobody will send is deleted (the server sweeps it otherwise). */
  function removeAlternative() {
    const alternative = form.getFieldValue('alternative');
    pdfUpload.current = null;
    form.setFieldValue('alternative', null);
    if (alternative?.kind === 'pdf' && alternative.pdf.attachment) {
      void deleteAssistantAttachment(scope.schoolId, alternative.pdf.attachment.id).catch(() => undefined);
    }
  }

  /** Files from the picker, a drop, a paste or the camera: photos join the paper's pages, a PDF becomes the source. */
  function addFiles(files: readonly File[]) {
    if (files.length === 0) return;
    const picks = sortSourcePicks(files, {
      alternative: form.getFieldValue('alternative'),
      photoCount: detail.paper.pageCount + uploadsInFlight(uploads.form.getFieldValue('items')),
    });
    uploads.dismissRejections();
    if (picks.photos.length > 0) uploads.addFiles(picks.photos, detail.paper.pageCount);
    uploads.reportRejections(picks.refused);
    if (picks.pdf) void addPdf(picks.pdf);
  }

  return {
    form,
    run,
    addFiles,
    removeAlternative,
    chooseEarlier: (earlier: EarlierPaper) => {
      removeAlternative();
      form.setFieldValue('alternative', { kind: 'earlier', earlier });
    },
  };
}

type PaperStart = ReturnType<typeof usePaperStart>;

/** The camera in a dialog: it opens ready to capture, and a captured photo joins the paper like any other. */
function CameraDialog({ open, onOpenChange, onCapture }: { open: boolean; onOpenChange: (open: boolean) => void; onCapture: (file: File) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Take a photo</DialogTitle>
          <DialogDescription>Hold the page flat and fill the frame with it.</DialogDescription>
        </DialogHeader>
        {open ? (
          <CameraCapture
            autoStart
            fileName="question-paper-photo.jpg"
            onCapture={(file) => {
              onCapture(file);
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * What the card could not take, and photos that failed on the way: one compact
 * row with the reason and a way to clear it. It also clears by itself the next
 * time something is added (`addFiles`), so it never sits beside new material.
 */
function StartProblems({ uploads }: { uploads: PageUploads }) {
  return (
    <uploads.form.Subscribe selector={(state) => [state.values.rejections, state.values.items] as const}>
      {([rejections, items]) => {
        const failed = items.filter((item) => item.status === 'error');
        const lines = [
          // The name alone can repeat (every camera capture is called question-paper-photo.jpg), so it is shown only to tell several lines apart.
          ...rejections.map((rejection) => ({ name: rejection.name, reason: rejection.reason })),
          ...failed.map((item) => ({ name: item.name, reason: item.error ?? 'The upload failed.' })),
        ];
        if (lines.length === 0) return null;
        return (
          <div role="alert" className="mx-4 mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 py-2 pe-1.5 ps-3 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <ul className="flex min-w-0 flex-1 flex-col gap-1">
              {lines.map((line, index) => (
                <li key={index}>{lines.length > 1 ? `${line.name}: ${line.reason}` : line.reason}</li>
              ))}
            </ul>
            <button
              type="button"
              aria-label="Dismiss"
              className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:size-9"
              onClick={() => {
                uploads.dismissRejections();
                for (const item of failed) uploads.dismiss(item.id);
              }}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        );
      }}
    </uploads.form.Subscribe>
  );
}

/** The chosen earlier paper as one row, with a way to look at it before it is copied. */
function EarlierSourceRow({ earlier, planMaxMarks, onRemove }: { earlier: EarlierPaper; planMaxMarks: number; onRemove: () => void }) {
  const [previewing, setPreviewing] = useState(false);
  const mismatch = marksMismatchOf(earlier, planMaxMarks);
  return (
    <>
      <PaperSourceItem
        icon={Copy}
        title={earlierPaperTitle(earlier)}
        detail={earlierPaperDetail(earlier)}
        actions={
          <Button type="button" variant="ghost" size="sm" onClick={() => setPreviewing(true)}>
            <Eye aria-hidden />
            Preview
          </Button>
        }
        removeLabel="Remove the earlier paper"
        onRemove={onRemove}
      />
      {/* A copy is the old paper as it is, so other marks are said before it is made, not found afterwards. */}
      {mismatch ? (
        <p className="flex items-start gap-2 text-[0.8125rem]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" aria-hidden />
          {mismatch}
        </p>
      ) : null}
      <EarlierPaperPreviewDialog earlier={earlier} open={previewing} onOpenChange={setPreviewing} />
    </>
  );
}

/** What the buttons beside the photos do: take files from the phone's camera, open the camera dialog, open the earlier-paper picker. */
type SourceActions = { onFiles: (files: File[]) => void; onCamera: () => void; onEarlier: () => void };

/** The paper's photos as a row of pages: add, look at one, reorder, remove. Removing asks first; the server holds the photos. */
function PhotoSources({
  scope,
  detail,
  uploads,
  closed,
  onPick,
  onFiles,
  onCamera,
  onEarlier,
}: Pick<StartProps, 'scope' | 'detail' | 'uploads'> & { closed: boolean; onPick: () => void } & SourceActions) {
  const { paper, pages } = detail;
  const reorder = usePageReorder(scope);
  const deletePage = useDeletePage(scope);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const capture = useRef<HTMLInputElement>(null);
  const deletingPage = pages.find((page) => page.id === deleting);
  return (
    <uploads.form.Subscribe selector={(state) => state.values.items}>
      {(items) => {
        const uploading = uploadsInFlight(items) > 0;
        const photoCount = paper.pageCount + uploadsInFlight(items);
        const cameraClosed = closed || photoCount >= QUESTION_PAPER_MAX_PAGES;
        // The other ways in sit with the material. A phone opens its own camera (flash, focus, full resolution) through
        // the capture input; a computer, whose file input cannot open a webcam, opens the camera dialog: which of the two
        // shows is decided by the pointer the device has (the tray does that, from `pointer`). An earlier paper is offered only while the card holds
        // no photo: photos and a copy never mix.
        const ways: PaperSourceWay[] = [
          { key: 'webcam', icon: Camera, label: 'Take a photo', disabled: cameraClosed, pointer: 'fine', onClick: onCamera },
          { key: 'camera', icon: Camera, label: 'Take a photo', disabled: cameraClosed, pointer: 'coarse', onClick: () => capture.current?.click() },
          ...(photoCount === 0 ? [{ key: 'earlier', icon: Copy, label: 'Copy an earlier paper', disabled: closed, onClick: onEarlier }] : []),
        ];
        return (
          <>
            <input
              ref={capture}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              aria-label="Take a photo of a page"
              onChange={(event) => {
                onFiles([...(event.target.files ?? [])]);
                event.target.value = '';
              }}
            />
            <PaperSourceTray
              pages={pages}
              uploads={items}
              thumbUrl={(pageId) => questionPaperThumbUrl(scope, pageId)}
              canAdd={!closed && paper.pageCount + uploadsInFlight(items) < QUESTION_PAPER_MAX_PAGES}
              // Every stored upload bumps the revision a reorder or removal is checked against, so both wait for the uploads.
              disabled={closed || uploading || reorder.isPending || deletePage.isPending}
              emptyTitle="Add the paper"
              emptyHint="Photos of its pages, or a PDF. We type it up for you."
              ways={ways}
              onAdd={onPick}
              onOpen={setViewing}
              onReorder={(pageIds) => reorder.mutate({ ...scope, pageIds, expectedPageRevision: paper.pageRevision })}
              onDelete={setDeleting}
              onDismissUpload={uploads.dismiss}
            />
            <PagePreviewDialog
              scope={scope}
              pages={pages}
              // The viewer steps aside while removal is confirmed, so two dialogs never stack.
              pageId={deleting === null ? viewing : null}
              onPageChange={setViewing}
              onRemove={closed || uploading || reorder.isPending || deletePage.isPending ? undefined : setDeleting}
            />
            <ConfirmationDialog
              open={deletingPage !== undefined}
              title={deletingPage ? `Remove page ${deletingPage.position}?` : 'Remove page?'}
              description="The other pages stay and are renumbered. Versions already saved are not changed."
              confirmLabel="Remove page"
              pending={deletePage.isPending}
              onOpenChange={(open) => {
                if (!open) setDeleting(null);
              }}
              onConfirm={() => {
                if (!deletingPage) return;
                deletePage.mutate(
                  { ...scope, pageId: deletingPage.id, expectedPageRevision: paper.pageRevision },
                  {
                    // A removed page cannot stay open in the viewer; a refused removal returns to it.
                    onSuccess: () => setViewing(null),
                    onSettled: () => setDeleting(null),
                  },
                );
              }}
            />
          </>
        );
      }}
    </uploads.form.Subscribe>
  );
}

/**
 * What the paper is made from: the chosen PDF or earlier paper as one row, or
 * else the paper's photos as a row of pages that ends in the add tile.
 */
function StartSources({
  scope,
  detail,
  uploads,
  start,
  closed,
  onPick,
  onCamera,
  onEarlier,
}: Pick<StartProps, 'scope' | 'detail' | 'uploads'> & { start: PaperStart; closed: boolean; onPick: () => void } & Omit<SourceActions, 'onFiles'>) {
  return (
    <start.form.Subscribe selector={(state) => state.values.alternative}>
      {(alternative) => {
        if (alternative?.kind === 'pdf') {
          const { pdf } = alternative;
          return (
            <PaperSourceItem
              icon={FileText}
              title={pdf.fileName}
              // A PDF is never opened in the page (it is sent to the model as it is), so the row can only name it.
              detail={pdf.status === 'uploading' ? 'Uploading…' : `PDF · ${formatAttachmentSize(pdf.byteSize)}`}
              status={pdf.status === 'uploading' ? 'working' : pdf.status}
              error={pdf.error}
              removeLabel={`Remove ${pdf.fileName}`}
              onRemove={start.removeAlternative}
            />
          );
        }
        if (alternative?.kind === 'earlier') return <EarlierSourceRow earlier={alternative.earlier} planMaxMarks={detail.paper.planMaxMarks} onRemove={start.removeAlternative} />;
        return <PhotoSources scope={scope} detail={detail} uploads={uploads} closed={closed} onPick={onPick} onFiles={start.addFiles} onCamera={onCamera} onEarlier={onEarlier} />;
      }}
    </start.form.Subscribe>
  );
}

/** The optional note: what to change, or with nothing else in the card, the description of the paper. */
function StartNote({
  start,
  hasPhotos,
  planMaxMarks,
  disabled,
  onPasteFiles,
}: {
  start: PaperStart;
  hasPhotos: boolean;
  planMaxMarks: number;
  disabled: boolean;
  onPasteFiles: (files: File[]) => void;
}) {
  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    // Pasted files are sources; anything else pastes as the browser would.
    const files = [...event.clipboardData.files];
    if (files.length === 0) return;
    event.preventDefault();
    onPasteFiles(files);
  };
  return (
    <start.form.Subscribe selector={(state) => state.values.alternative}>
      {(alternative) => {
        const marksDiffer = alternative?.kind === 'earlier' && marksMismatchOf(alternative.earlier, planMaxMarks) !== null;
        const words = noteWordsOf({ alternative, hasPhotos, marksDiffer });
        return (
          <start.form.Field name="note">
            {(field) => (
              <div className="flex flex-col gap-1.5 px-4 pb-3">
                <label htmlFor="question-paper-note" className="text-xs font-medium text-muted-foreground">
                  {words.label}
                </label>
                <textarea
                  id="question-paper-note"
                  rows={1}
                  value={field.state.value}
                  disabled={disabled}
                  placeholder={words.placeholder}
                  aria-invalid={field.state.meta.errors.length > 0}
                  aria-describedby={field.state.meta.errors.length > 0 ? 'question-paper-note-error' : undefined}
                  className="field-sizing-content max-h-52 min-h-11 w-full resize-none rounded-lg border border-input bg-background/60 px-3 py-2 text-base/relaxed outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed sm:text-sm/relaxed"
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  onPaste={handlePaste}
                />
                {field.state.meta.errors.length > 0 ? (
                  <p id="question-paper-note-error" role="alert" className="text-sm text-destructive">
                    {field.state.meta.errors.map((error) => (typeof error === 'string' ? error : error?.message)).filter(Boolean).join(' ')}
                  </p>
                ) : null}
              </div>
            )}
          </start.form.Field>
        );
      }}
    </start.form.Subscribe>
  );
}

/**
 * The card's last row: the one button, with one line beside it, and Back
 * beside the button when the paper has a studio to return to. The line says
 * why the button is closed or why creating failed; when nothing is wrong
 * there is no line.
 */
function StartFooter({
  detail,
  uploads,
  start,
  blockedReason,
  onBack,
}: Pick<StartProps, 'detail' | 'uploads' | 'onBack'> & { start: PaperStart; blockedReason: string | null }) {
  const { paper } = detail;
  const templateReason = detail.templateConfigured ? null : 'Choose a question paper template before creating papers.';
  return (
    <uploads.form.Subscribe selector={(state) => uploadsInFlight(state.values.items) > 0}>
      {(uploading) => (
        <start.form.Subscribe selector={(state) => [state.values.alternative, state.values.note, state.isSubmitting, state.canSubmit] as const}>
          {([alternative, note, isSubmitting, canSubmit]) => {
            const plan = createPlanOf({ alternative, pageCount: paper.pageCount, uploading, note });
            const reason = blockedReason ?? (plan.kind === 'blocked' ? plan.reason : templateReason);
            const failure = start.run.error ? requestErrorMessage(start.run.error, 'The paper could not be created.') : null;
            const line = reason;
            return (
              // The line comes first, for a reader and on the screen: left of the button from `sm` up, above it on a phone.
              <div className="flex flex-col gap-2 px-4 pb-4 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                {failure ? (
                  <p role="alert" className="text-sm text-destructive">
                    {failure}
                  </p>
                ) : line ? (
                  <p className="text-[0.8125rem] text-muted-foreground">{line}</p>
                ) : null}
                <div className="flex shrink-0 gap-2">
                  {onBack ? (
                    <Button type="button" variant="outline" onClick={onBack}>
                      Back
                    </Button>
                  ) : null}
                  {/* A closed button is grey, not a dimmed primary: the brand colour means "this will create the paper". */}
                  <Button
                    type="submit"
                    className="disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 max-sm:flex-1"
                    disabled={reason !== null || plan.kind === 'blocked' || !canSubmit || isSubmitting}
                  >
                    {isSubmitting ? 'Creating…' : paper.latestVersionNo > 0 ? 'Create new version' : 'Create paper'}
                  </Button>
                </div>
              </div>
            );
          }}
        </start.form.Subscribe>
      )}
    </uploads.form.Subscribe>
  );
}

/** Photos the paper keeps while a PDF or an earlier paper is used instead: said once, so nothing seems lost. */
function UnusedPhotosNote({ start, pageCount }: { start: PaperStart; pageCount: number }) {
  return (
    <start.form.Subscribe selector={(state) => state.values.alternative !== null}>
      {(replaced) =>
        replaced && pageCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            {pageCount === 1 ? 'The photo already added stays with this paper and is not used.' : `The ${pageCount} photos already added stay with this paper and are not used.`}
          </p>
        ) : null
      }
    </start.form.Subscribe>
  );
}

/**
 * The paper's first screen: one card, in the shape of the assistant's message
 * box beside which the paper is later changed. On top is what the paper is
 * made from (photos of its pages as a row of tiles that ends in an add tile,
 * or one PDF, or an earlier paper), under it an optional note, and one button.
 * Nothing has to be typed: photos alone make a paper. A note alone is a
 * description the assistant writes the paper from. Files can also be dropped
 * on the card or pasted into the note.
 *
 * It is also how a paper that already has versions gets another start (more
 * photos, a copy): then it says that a new version is added, and Back beside
 * the button (and the arrow by the paper's name) returns to the paper.
 */
export function QuestionPaperStart({ scope, detail, canManage, uploads, earlierOpen, onEarlierOpenChange, onOpenStudio, onBack }: StartProps) {
  const { paper } = detail;
  const start = usePaperStart({ scope, detail, uploads, onOpenStudio });
  const picker = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const hasVersion = paper.latestVersionNo > 0;
  const blockedReason = editBlockedReason({
    examCompleted: paper.examCompleted,
    sessionActive: paper.sessionActive,
    canManage,
    jobActive: inFlightJob(detail.activeJob) !== null,
  });
  const closed = blockedReason !== null;
  const failure = currentJobFailure(detail);
  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    setDropping(false);
    if (closed || event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    start.addFiles([...event.dataTransfer.files]);
  };
  return (
    <div className="flex flex-col gap-4">
      {hasVersion ? <p className="text-sm text-muted-foreground">This adds a new version. The versions you have are kept.</p> : null}
      {failure ? <GenerationStatus job={{ status: 'failed', message: failure.message }} /> : null}
      <form
        aria-label="Create the question paper"
        className={cn(
          'relative flex flex-col rounded-2xl bg-card shadow-composer transition-shadow',
          'after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-surface-outline',
          dropping && 'ring-2 ring-primary/50',
        )}
        onDragOver={(event) => {
          if (closed || !event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
        }}
        onDrop={handleDrop}
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void start.form.handleSubmit();
        }}
      >
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          accept={START_SOURCE_ACCEPT}
          aria-label="Add photos or a PDF"
          onChange={(event) => {
            start.addFiles([...(event.target.files ?? [])]);
            // The same file can be picked again after it was removed.
            event.target.value = '';
          }}
        />
        <div className="flex flex-col gap-3 p-4">
          <StartSources
            scope={scope}
            detail={detail}
            uploads={uploads}
            start={start}
            closed={closed}
            onPick={() => picker.current?.click()}
            onCamera={() => setCameraOpen(true)}
            onEarlier={() => onEarlierOpenChange(true)}
          />
          <UnusedPhotosNote start={start} pageCount={paper.pageCount} />
        </div>
        <StartProblems uploads={uploads} />
        <StartNote start={start} hasPhotos={paper.pageCount > 0} planMaxMarks={paper.planMaxMarks} disabled={closed} onPasteFiles={start.addFiles} />
        <StartFooter detail={detail} uploads={uploads} start={start} blockedReason={blockedReason} onBack={onBack} />
      </form>
      {detail.pages.some((page) => page.derivativeStatus === 'unsupported') ? (
        <p className="text-xs text-muted-foreground">
          Some photos have no preview here. The AI can still read them if its model supports the format; if creating is
          refused, convert those pages to JPEG and add them again.
        </p>
      ) : null}
      <CameraDialog open={cameraOpen} onOpenChange={setCameraOpen} onCapture={(file) => start.addFiles([file])} />
      <EarlierPaperDialog
        scope={scope}
        className={paper.className}
        subjectName={paper.subjectName}
        open={earlierOpen && !closed}
        onOpenChange={onEarlierOpenChange}
        onChoose={(earlier) => {
          start.chooseEarlier(earlier);
          onEarlierOpenChange(false);
        }}
      />
    </div>
  );
}

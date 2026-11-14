'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Languages, ListChecks, Sparkles, WandSparkles, X } from 'lucide-react';
import { APP_SHELL_FILL_HEIGHT_MD_CLASS } from '@campuspilot/components/app-shell';
import type { AssistantSuggestion } from '@campuspilot/components/assistant';
import { DocumentPreview } from '@campuspilot/components/documents/document-controls';
import { OptionSelect } from '@campuspilot/components/option-select';
import { GenerationStatus } from '@campuspilot/components/question-paper/generation-status';
import { PlaceholderNote, RemovedList } from '@campuspilot/components/question-paper/paper-notices';
import { isPaperLocked, versionSourceLabel } from '@campuspilot/components/question-paper/question-paper-model';
import { Button } from '@campuspilot/ui/components/button';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { toast } from '@campuspilot/ui/lib/toast';
import { cn } from '@campuspilot/ui/lib/utils';
import { AssistantChat } from '@/components/assistant/assistant-chat';
import { DraftPreviewBody } from '@/components/assistant/assistant-question-paper';
import { useSendAssistantMessage } from '@/components/assistant/use-assistant';
import { ReadError } from '@/components/exam/exam-common';
import { orpc } from '@/lib/orpc';
import { currentJobFailure, inFlightJob, requestErrorMessage, shownPaperOf, type QuestionPaperScope, type ShownPaper } from './question-paper-model';
import { PAPER_ASSISTANT_SURFACE, paperSeedOf, usePaperDraft, type PaperDraft } from './use-paper-assistant';
import { useDownloadQuestionPaper, type QuestionPaperDetail } from './use-question-paper-detail';

/**
 * What the assistant is asked with one click on a new conversation. Each is a
 * whole request about this paper, worded so the answer is a draft to look at
 * (the assistant never saves without the user's approval).
 */
const PAPER_SUGGESTIONS: readonly AssistantSuggestion[] = [
  {
    id: 'check',
    icon: ListChecks,
    label: 'Check the paper for mistakes',
    prompt: 'Check this paper for spelling, numbering and marks mistakes. Tell me what you find before changing anything.',
  },
  {
    id: 'hindi',
    icon: Languages,
    label: 'Add the instructions in Hindi',
    prompt: 'Add the instructions of every section in Hindi under the English ones, and show me the draft.',
  },
  {
    id: 'easier',
    icon: WandSparkles,
    label: 'Make the paper a little easier',
    prompt: 'Make the questions a little easier for this class, keeping the same sections and marks, and show me the draft.',
  },
];

const PAPER_WELCOME = { title: 'Ask for a change', text: 'Say what to change in this paper. I show a draft first and save it only when you approve.' };

/**
 * The paper's assistant: the left column of the studio on wide screens, as
 * tall as the window so its message box (and an approval waiting in it) is
 * always on screen; on a phone a full-screen sheet opened from a bar at the
 * bottom (the paper is the screen there). It is one chat in both layouts, so
 * what was typed and the conversation survive turning the phone or resizing
 * the window.
 *
 * The chat that starts the conversation stays mounted as the address gains
 * its id; a new conversation, or another one opened from the address, is a
 * new chat (its own key), so no chat carries one conversation into another.
 */
function PaperAssistant({
  scope,
  chatId,
  open,
  onOpenChange,
  onChat,
}: {
  scope: QuestionPaperScope;
  chatId: string | null;
  /** Whether the sheet is open; only a phone has a sheet. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChat: (chatId: string | null) => void;
}) {
  const [session, setSession] = useState<{ generation: number; started: string | null }>({ generation: 0, started: null });
  const startNew = () => {
    setSession((current) => ({ generation: current.generation + 1, started: null }));
    onChat(null);
  };
  return (
    <>
      <aside
        aria-label="Assistant for this paper"
        className={cn(
          'min-h-0 min-w-0 flex-col bg-background md:static md:z-auto md:flex md:border-r',
          open ? 'fixed inset-0 z-40 flex' : 'hidden',
        )}
      >
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium">Assistant</h3>
          {chatId ? (
            <Button type="button" variant="ghost" size="sm" onClick={startNew}>
              New conversation
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon" className="md:hidden" aria-label="Close assistant" onClick={() => onOpenChange(false)}>
            <X aria-hidden />
          </Button>
        </header>
        <div className="min-h-0 flex-1">
          <AssistantChat
            key={chatId === null || chatId === session.started ? `new:${session.generation}` : chatId}
            schoolId={scope.schoolId}
            conversationId={chatId}
            surface={PAPER_ASSISTANT_SURFACE}
            compact
            gutterClassName="px-3"
            seed={paperSeedOf(scope)}
            seedText=""
            welcome={PAPER_WELCOME}
            placeholder="Ask for a change to this paper…"
            suggestions={PAPER_SUGGESTIONS}
            onConversationStarted={(id) => {
              setSession((current) => ({ ...current, started: id }));
              onChat(id);
            }}
            onNewConversation={startNew}
          />
        </div>
      </aside>
      {open ? null : (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background p-3 md:hidden">
          <Button type="button" className="w-full" onClick={() => onOpenChange(true)}>
            <Sparkles data-icon="inline-start" aria-hidden /> Ask for a change
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Where the paper is drawn: the rest of the paper's pane on wide screens (the
 * page is scaled to the pane's width and scrolls inside it), and a tall frame
 * on a phone, where the page scrolls. Never wider than a comfortable page.
 */
function PaperFrame({ children }: { children: ReactNode }) {
  return <div className="mx-auto h-[75dvh] w-full max-w-4xl md:h-auto md:min-h-0 md:flex-1">{children}</div>;
}

/** One saved version as it prints: what was removed from its HTML, its figure placeholders and the sandboxed preview. */
function SavedVersion({ scope, versionNo }: { scope: QuestionPaperScope; versionNo: number }) {
  const preview = useQuery(orpc.school.getQuestionPaperPreview.queryOptions({ input: { ...scope, versionNo } }));
  // Resolve from held data before the error flag, so a failed refetch never blanks a paper on screen.
  if (preview.data === undefined) {
    return preview.isPending ? (
      <PaperFrame>
        <Skeleton className="h-full w-full rounded-xl" />
      </PaperFrame>
    ) : (
      <ReadError error={preview.error} retry={preview.refetch} />
    );
  }
  return (
    <>
      <RemovedList lines={preview.data.warnings.map((notice) => notice.message)} />
      <PlaceholderNote count={preview.data.placeholderFigures} />
      <PaperFrame>
        <DocumentPreview html={preview.data.html} label="Question paper preview" fitPageWidth fill />
      </PaperFrame>
    </>
  );
}

/**
 * The assistant's draft that no version holds yet, as it would print, with the
 * one action it needs. Saving is a request to the assistant in the paper's
 * conversation (the same sentence the draft card in the chat sends), which
 * then asks for approval there like every other change.
 */
function UnsavedDraft({ scope, draft, nextVersionNo, onSave, saving }: { scope: QuestionPaperScope; draft: PaperDraft; nextVersionNo: number; onSave: () => void; saving: boolean }) {
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-medium">Draft {draft.ordinal} is not saved yet</p>
          <p className="text-xs text-muted-foreground">
            {draft.saveRequested ? 'Approve the save in the assistant to add it to the paper.' : `Saving adds it as version ${nextVersionNo}.`}
          </p>
        </div>
        <Button type="button" disabled={draft.saveRequested || saving} onClick={onSave}>
          {draft.saveRequested || saving ? 'Save requested' : `Save as version ${nextVersionNo}`}
        </Button>
      </div>
      <RemovedList lines={draft.removed} />
      <PlaceholderNote count={draft.placeholderFigures} />
      <PaperFrame>
        <DraftPreviewBody schoolId={scope.schoolId} input={draft.input} draftId={draft.draftId} fill />
      </PaperFrame>
    </>
  );
}

/** Which version or draft is shown, and its PDF. */
function PaperToolbar({
  scope,
  detail,
  shown,
  draft,
  onVersion,
}: {
  scope: QuestionPaperScope;
  detail: QuestionPaperDetail;
  shown: ShownPaper;
  draft: PaperDraft | null;
  onVersion: (versionNo: number | null) => void;
}) {
  const download = useDownloadQuestionPaper();
  const version = shown.kind === 'version' ? detail.versions.find((candidate) => candidate.versionNo === shown.versionNo) : undefined;
  const options = [
    ...(draft ? [{ value: 'draft', label: `Draft ${draft.ordinal} (not saved)` }] : []),
    ...detail.versions.map((candidate) => ({ value: String(candidate.versionNo), label: `Version ${candidate.versionNo}${candidate.isLatest ? ' (latest)' : ''}` })),
  ];
  if (options.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {version ? <span className="text-xs text-muted-foreground max-lg:hidden">{versionSourceLabel(version.source)}</span> : null}
      <OptionSelect
        value={shown.kind === 'version' ? String(shown.versionNo) : 'draft'}
        options={options}
        onValueChange={(value) => onVersion(value === 'draft' ? null : Number(value))}
        triggerProps={{ 'aria-label': 'Version', className: 'w-48' }}
      />
      {version ? (
        <Button
          type="button"
          variant="outline"
          disabled={download.isPending}
          onClick={() =>
            download.mutate(
              { ...scope, versionNo: version.versionNo },
              { onError: (error) => toast.error(requestErrorMessage(error, 'The PDF could not be prepared.')) },
            )
          }
        >
          <Download aria-hidden /> {download.isPending ? 'Preparing…' : 'Download PDF'}
        </Button>
      ) : null}
    </div>
  );
}

/** The state of the AI generation from photos, said once at the top of the paper: at work (with the note it was given), or failed with the way back to the photos. */
function GenerationNotice({ detail, onOpenPhotos }: { detail: QuestionPaperDetail; onOpenPhotos: () => void }) {
  const running = inFlightJob(detail.activeJob);
  if (running) {
    const instructions = detail.activeJob?.instructions;
    return (
      <div className="flex flex-col gap-2">
        <GenerationStatus job={running} />
        {instructions ? (
          <p className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm">
            <span className="block text-xs text-muted-foreground">Your instructions</span>
            {instructions}
          </p>
        ) : null}
      </div>
    );
  }
  const failure = currentJobFailure(detail);
  if (!failure) return null;
  return (
    <div className="flex flex-col gap-2">
      <GenerationStatus job={{ status: 'failed', message: failure.message }} />
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={onOpenPhotos}>
        Open the photos
      </Button>
    </div>
  );
}

/**
 * The studio: the paper, as it prints, beside the assistant that changes it.
 * On wide screens it fills the window under the app's header, like the
 * assistant's own page: one header row (the paper's name, the version shown,
 * its PDF and the menu), then the assistant on the left and the paper on the
 * right, each scrolling inside its pane, so nothing is cut off on arrival and
 * the page itself never scrolls. On a phone it is an ordinary page: the paper,
 * with the assistant one tap away.
 *
 * The paper's side shows a saved version or the assistant's unsaved draft; the
 * assistant's side is the paper's own conversation. Changes are always asked
 * of the assistant, which drafts first and saves on approval, so the paper on
 * screen is never edited by hand (versions are immutable).
 *
 * A viewer, and a paper whose exam has ended, get the paper alone: there is
 * nothing they could ask to change. So does a first paper while it is still
 * being generated from photos: there is no paper to ask about yet.
 */
export function QuestionPaperStudio({
  scope,
  detail,
  canManage,
  chatId,
  versionParam,
  heading,
  menu,
  notice,
  onVersion,
  onChat,
  onOpenPhotos,
}: {
  scope: QuestionPaperScope;
  detail: QuestionPaperDetail;
  canManage: boolean;
  /** The paper's conversation, from the address; null when none was started yet. */
  chatId: string | null;
  /** The version the address names (unchecked); null shows the newest thing. */
  versionParam: string | null;
  /** The paper's name and status, and its menu: the ends of the header row. */
  heading: ReactNode;
  menu: ReactNode;
  /** Why the paper cannot be changed, when it cannot; shown under the header. */
  notice: ReactNode;
  onVersion: (versionNo: number | null) => void;
  onChat: (chatId: string | null) => void;
  onOpenPhotos: () => void;
}) {
  // The assistant changes a paper, so it needs one to talk about: a saved version, or the conversation that is writing it.
  const canAsk = canManage && !isPaperLocked(detail.paper) && (detail.paper.latestVersionNo > 0 || chatId !== null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const draft = usePaperDraft(scope, canAsk ? chatId : null, detail.paper);
  const { send, isPending: saving } = useSendAssistantMessage(scope.schoolId, PAPER_ASSISTANT_SURFACE);
  const shown = shownPaperOf(versionParam, detail.versions.map((version) => version.versionNo), draft !== null);
  const saveDraft = () => {
    if (!draft || !chatId) return;
    // The approval that follows appears in the assistant, so a phone shows it.
    setAssistantOpen(true);
    void send(draft.saveRequest, chatId).catch((error: unknown) => toast.error(requestErrorMessage(error, 'The save could not be requested.')));
  };
  return (
    // md+: cancels the shell's page padding and takes the window's remaining height. Phone: an ordinary page, with room for the assistant's bar.
    <div className={cn('flex min-w-0 flex-col gap-4 md:-m-6 md:gap-0 lg:-m-8', APP_SHELL_FILL_HEIGHT_MD_CLASS, canAsk && 'max-md:pb-16')}>
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 md:border-b md:px-4 md:py-2.5">
        <div className="min-w-0 flex-1">{heading}</div>
        {/* On a phone the menu stays beside the name and the version row goes underneath. */}
        <div className="max-md:order-last max-md:basis-full">
          <PaperToolbar scope={scope} detail={detail} shown={shown} draft={draft} onVersion={onVersion} />
        </div>
        {menu}
      </header>
      <div className={cn('grid min-h-0 min-w-0 flex-1', canAsk && 'md:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]')}>
        {canAsk ? <PaperAssistant scope={scope} chatId={chatId} open={assistantOpen} onOpenChange={setAssistantOpen} onChat={onChat} /> : null}
        <section aria-label="Paper" className="flex min-h-0 min-w-0 flex-col gap-3 md:overflow-hidden md:bg-muted/30 md:p-4">
          {notice}
          <GenerationNotice detail={detail} onOpenPhotos={onOpenPhotos} />
          {shown.kind === 'draft' && draft ? (
            <UnsavedDraft scope={scope} draft={draft} nextVersionNo={detail.paper.latestVersionNo + 1} onSave={saveDraft} saving={saving} />
          ) : null}
          {shown.kind === 'version' ? <SavedVersion key={shown.versionNo} scope={scope} versionNo={shown.versionNo} /> : null}
          {shown.kind === 'nothing' ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {inFlightJob(detail.activeJob) ? 'The paper appears here when it is ready.' : 'No paper yet. The assistant’s draft appears here as soon as it writes one.'}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

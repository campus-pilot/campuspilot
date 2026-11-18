'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Columns2, Download, History, Images, Languages, ListChecks, PanelLeftClose, PanelLeftOpen, Sparkles, SquarePen, WandSparkles, X } from 'lucide-react';
import { APP_SHELL_FILL_HEIGHT_MD_CLASS } from '@campuspilot/components/app-shell';
import type { AssistantSuggestion } from '@campuspilot/components/assistant';
import { OptionSelect } from '@campuspilot/components/option-select';
import { GenerationStatus } from '@campuspilot/components/question-paper/generation-status';
import { PlaceholderNote, RemovedList } from '@campuspilot/components/question-paper/paper-notices';
import { isPaperLocked, versionSourceLabel } from '@campuspilot/components/question-paper/question-paper-model';
import { Button } from '@campuspilot/ui/components/button';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { toast } from '@campuspilot/ui/lib/toast';
import { cn } from '@campuspilot/ui/lib/utils';
import { AssistantChat } from '@/components/assistant/assistant-chat';
import { DraftPreviewBody } from '@/components/assistant/assistant-question-paper';
import { useSendAssistantMessage } from '@/components/assistant/use-assistant';
import { orpc } from '@/lib/orpc';
import {
  assistantCollapsedOf,
  canCompareOf,
  currentJobFailure,
  draftIsNewest,
  inFlightJob,
  requestErrorMessage,
  shownPaperOf,
  type QuestionPaperScope,
  type ShownPaper,
} from './question-paper-model';
import { PAPER_ASSISTANT_SURFACE, paperSeedOf, usePaperDraft, type PaperDraft } from './use-paper-assistant';
import { PaperChatHistoryDialog } from './paper-chat-history';
import { PaperPhotoCompare } from './paper-photo-compare';
import { VersionPdf } from './version-pdf';
import { TwoWaySwitch } from './source-preview-dialogs';
import type { PageUploads } from './use-page-uploads';
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

const PAPER_WELCOME = {
  title: 'Ask for a change',
  text: 'Say what to change in this paper. Each change is saved as a new version, and earlier versions stay. Everyone who can open this paper sees this chat.',
};

/** An icon button of the assistant's header, named by its tooltip. */
function HeaderIconButton({ label, icon, onClick, className }: { label: string; icon: ReactNode; onClick: () => void; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" className={className} aria-label={label} onClick={onClick}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The slim strip the assistant folds into on wide screens, beside the app's
 * sidebar: one tall button that opens it again. While a draft the assistant
 * wrote is waiting to be saved, the strip says so with a dot and its tooltip,
 * so hiding the chat never hides that something needs an answer there.
 */
function AssistantRail({ draftOrdinal, onOpen }: { draftOrdinal: number | null; onOpen: () => void }) {
  const label = draftOrdinal === null ? 'Show assistant' : `Show assistant (Draft ${draftOrdinal} is not saved yet)`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-expanded={false}
          onClick={onOpen}
          className="group hidden w-11 flex-col items-center gap-3 border-r bg-background py-3 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:flex"
        >
          <PanelLeftOpen className="size-4" aria-hidden />
          <span className="relative">
            <Sparkles className="size-4 text-primary transition-transform group-hover:scale-110" aria-hidden />
            {draftOrdinal === null ? null : <span className="absolute -end-1 -top-1 size-2 rounded-full bg-primary ring-2 ring-background" aria-hidden />}
          </span>
          <span className="rotate-180 text-xs font-medium tracking-wide [writing-mode:vertical-rl]">Ask the assistant</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The paper's assistant: the left column of the studio on wide screens, as
 * tall as the window so its message box (and an approval waiting in it) is
 * always on screen; on a phone a full-screen sheet opened from a bar at the
 * bottom (the paper is the screen there). It is one chat in both layouts, so
 * what was typed and the conversation survive turning the phone or resizing
 * the window.
 *
 * The conversation is the paper's, not the user's: it is shared with the
 * paper, so a colleague who opens the paper finds the latest one here and
 * carries on (`shareWithPaper`). Its header starts a new one and, for
 * someone who may change the paper, lists the paper's earlier ones; the
 * assistant's own page keeps each person's full history. Someone who may
 * only read the paper reads the conversation without a message box.
 *
 * On wide screens it can be hidden so the paper takes the whole width; it then
 * folds into a strip beside the app's sidebar (`AssistantRail`) that opens it
 * again. Hiding only stops showing it: the chat stays mounted, so a half-typed
 * message and a reply still streaming are there when it is shown again.
 *
 * The chat that starts the conversation stays mounted as the address gains
 * its id; a new conversation, or another one opened from the address, is a
 * new chat (its own key), so no chat carries one conversation into another.
 */
function PaperAssistant({
  scope,
  chatId,
  readOnlyReason,
  canSeeHistory,
  open,
  onOpenChange,
  collapsed,
  onCollapsedChange,
  draftOrdinal,
  onChat,
}: {
  scope: QuestionPaperScope;
  chatId: string | null;
  /** Why this user may read the paper's conversation but not write in it; null when they may write (and start new ones). */
  readOnlyReason: string | null;
  /** The user may manage the class's papers: they see the paper's chat history (also when the paper can no longer change). */
  canSeeHistory: boolean;
  /** Whether the sheet is open; only a phone has a sheet. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether it is hidden on wide screens (a phone ignores this and uses `open`). */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** The ordinal of the assistant's draft waiting to be saved, shown on the strip while hidden; null when there is none. */
  draftOrdinal: number | null;
  onChat: (chatId: string | null) => void;
}) {
  const [session, setSession] = useState<{ generation: number; started: string | null }>({ generation: 0, started: null });
  const [historyOpen, setHistoryOpen] = useState(false);
  const canWrite = readOnlyReason === null;
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
          collapsed && 'md:hidden',
        )}
      >
        <header className="flex h-11 shrink-0 items-center gap-1 border-b px-3">
          <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <h3 className="ms-1 min-w-0 flex-1 truncate text-sm font-medium">Assistant</h3>
          {canSeeHistory ? <HeaderIconButton label="Chat history" icon={<History aria-hidden />} onClick={() => setHistoryOpen(true)} /> : null}
          {canWrite && chatId ? <HeaderIconButton label="New chat" icon={<SquarePen aria-hidden />} onClick={startNew} /> : null}
          <HeaderIconButton label="Hide assistant" icon={<PanelLeftClose aria-hidden />} onClick={() => onCollapsedChange(true)} className="max-md:hidden" />
          <Button type="button" variant="ghost" size="icon-sm" className="md:hidden" aria-label="Close assistant" onClick={() => onOpenChange(false)}>
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
            shareWithPaper
            readOnlyReason={readOnlyReason}
            welcome={PAPER_WELCOME}
            trustCue="Saves each change as a new version"
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
      {collapsed ? <AssistantRail draftOrdinal={draftOrdinal} onOpen={() => onCollapsedChange(false)} /> : null}
      {open ? null : (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background p-3 md:hidden">
          <Button type="button" className="w-full" onClick={() => onOpenChange(true)}>
            <Sparkles data-icon="inline-start" aria-hidden /> {canWrite ? 'Ask for a change' : 'Open the conversation'}
          </Button>
        </div>
      )}
      {canSeeHistory ? <PaperChatHistoryDialog scope={scope} open={historyOpen} onOpenChange={setHistoryOpen} currentId={chatId} onChoose={onChat} /> : null}
    </>
  );
}

/**
 * Where the paper is drawn: the rest of the paper's pane on wide screens (the
 * page is scaled to the pane's width and scrolls inside it), and a tall frame
 * on a phone, where the page scrolls. Never wider than a comfortable page.
 * Beside the photos it is the right half of the stage ({@link PaperStage});
 * on a phone it steps aside while the photos have the frame.
 */
function PaperFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto h-[75dvh] w-full max-w-4xl md:col-start-2 md:row-start-2 md:h-auto md:min-h-0 md:flex-1 max-md:group-data-[side=photos]/stage:hidden">
      {children}
    </div>
  );
}

/**
 * What is said about the paper above it (an unsaved draft's card, what was
 * removed from its HTML, its figure placeholders, a failed read). Beside the
 * photos these lines stay above the paper, in a row of their own that the
 * photo leaves empty: they are about the paper, and the two sheets still
 * start at the same height whatever is said here. With nothing to say it
 * takes no room.
 */
function PaperNotes({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 flex-col gap-3 pb-3 empty:hidden md:col-start-2 md:row-start-1 max-md:order-first">{children}</div>;
}

/**
 * The part of the paper's pane the paper is drawn in, and, while the paper is
 * compared with its photos (`photos` is given), the photos beside it.
 *
 * - **Wide screens.** Two equal panes, the photo on the left and the paper on
 *   the right, each scrolling on its own (nothing keeps them in step: a
 *   photographed page and a printed page do not hold the same lines). The
 *   paper's notes ({@link PaperNotes}) have the row above the paper to
 *   themselves, so the sheets' top edges line up.
 * - **A phone** has no room for two panes: a switch above the frame chooses
 *   which of the two the frame shows. Both stay mounted, so switching never
 *   loads the paper or the photo again.
 *
 * The paper keeps its place in the tree whether or not the photos are there,
 * so turning the comparison on and off never draws the paper again.
 */
function PaperStage({ photos, children }: { photos: ReactNode; children: ReactNode }) {
  const [side, setSide] = useState<'photos' | 'paper'>('photos');
  const comparing = Boolean(photos);
  return (
    <div
      data-side={comparing ? side : undefined}
      className={cn(
        'group/stage flex min-w-0 flex-col md:min-h-0 md:flex-1',
        comparing && 'md:mx-auto md:grid md:w-full md:max-w-[113rem] md:grid-cols-2 md:grid-rows-[auto_minmax(0,1fr)] md:gap-x-4',
      )}
    >
      {comparing ? (
        <TwoWaySwitch
          label="Show"
          className="mb-3 md:hidden"
          value={side}
          options={[
            { value: 'photos', label: 'Photos' },
            { value: 'paper', label: 'Paper' },
          ]}
          onValueChange={setSide}
        />
      ) : null}
      {comparing ? <div className={cn('h-[75dvh] min-w-0 md:col-start-1 md:row-start-2 md:h-auto md:min-h-0', side === 'paper' && 'max-md:hidden')}>{photos}</div> : null}
      {children}
    </div>
  );
}

/**
 * One saved version as it prints: its PDF (the stored file, with its page
 * breaks), and above it what was removed from its HTML and its figure
 * placeholders. The notes come from the version's HTML preview; while they
 * load, or if they cannot be read, the paper shows without them.
 */
function SavedVersion({ scope, versionNo }: { scope: QuestionPaperScope; versionNo: number }) {
  const notes = useQuery(orpc.school.getQuestionPaperPreview.queryOptions({ input: { ...scope, versionNo } }));
  return (
    <>
      <PaperNotes>
        {notes.data ? (
          <>
            <RemovedList lines={notes.data.warnings.map((notice) => notice.message)} />
            <PlaceholderNote count={notes.data.placeholderFigures} />
          </>
        ) : null}
      </PaperNotes>
      <PaperFrame>
        <VersionPdf scope={scope} versionNo={versionNo} />
      </PaperFrame>
    </>
  );
}

/** That the draft on screen is not saved, with the one action it needs (absent for someone who may not change the paper). */
function DraftSaveCard({ draft, nextVersionNo, onSave, saving }: { draft: PaperDraft; nextVersionNo: number; onSave: (() => void) | null; saving: boolean }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-medium">Draft {draft.ordinal} is not saved yet</p>
        <p className="text-xs text-muted-foreground">
          {!onSave
            ? 'Only someone who can change this paper can save it.'
            : draft.saveRequested
              ? 'Approve the save in the assistant to add it to the paper.'
              : `Saving adds it as version ${nextVersionNo}.`}
        </p>
      </div>
      {onSave ? (
        <Button type="button" disabled={draft.saveRequested || saving} onClick={onSave}>
          {draft.saveRequested || saving ? 'Save requested' : `Save as version ${nextVersionNo}`}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The assistant's draft that no version holds yet, as it would print, with the
 * one action it needs. Saving is a request to the assistant in the paper's
 * conversation (the same sentence the draft card in the chat sends), which
 * then asks for approval there like every other change.
 */
function UnsavedDraft({
  scope,
  chatId,
  draft,
  nextVersionNo,
  onSave,
  saving,
}: {
  scope: QuestionPaperScope;
  chatId: string;
  draft: PaperDraft;
  nextVersionNo: number;
  onSave: (() => void) | null;
  saving: boolean;
}) {
  return (
    <>
      <PaperNotes>
        <DraftSaveCard draft={draft} nextVersionNo={nextVersionNo} onSave={onSave} saving={saving} />
        <RemovedList lines={draft.removed} />
        <PlaceholderNote count={draft.placeholderFigures} />
      </PaperNotes>
      <PaperFrame>
        <DraftPreviewBody schoolId={scope.schoolId} conversationId={chatId} input={draft.input} draftId={draft.draftId} fill />
      </PaperFrame>
    </>
  );
}

/**
 * The paper's photos (or the way to add some), one click from the paper: an
 * icon beside Download PDF, named by its tooltip. It opens the same card as
 * the menu's "Add photos or a file", where the photos are checked, reordered
 * or added to.
 */
function SourcesButton({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label={label} onClick={onOpen}>
          <Images aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Shows the paper beside its photographed pages, so what was typed can be read
 * against what was written. One quiet toggle beside the photos button, named
 * by its tooltip; its name stays the same and `aria-pressed` says whether it
 * is on.
 */
function CompareToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant={on ? 'secondary' : 'outline'} size="icon" aria-label="Compare with photos" aria-pressed={on} onClick={() => onChange(!on)}>
          <Columns2 aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Compare with photos</TooltipContent>
    </Tooltip>
  );
}

/** Which version or draft is shown, the paper's photos, the comparison with them and its PDF. */
function PaperToolbar({
  scope,
  detail,
  shown,
  draft,
  onVersion,
  sources,
  compare,
}: {
  scope: QuestionPaperScope;
  detail: QuestionPaperDetail;
  shown: ShownPaper;
  draft: PaperDraft | null;
  onVersion: (versionNo: number | null) => void;
  /** The photos button, when there is one (`QuestionPaperStudio`'s `onOpenSources`). */
  sources: ReactNode;
  /** The toggle that shows the photos beside the paper, when the paper can be compared (`canCompareOf`). */
  compare: ReactNode;
}) {
  const download = useDownloadQuestionPaper();
  const version = shown.kind === 'version' ? detail.versions.find((candidate) => candidate.versionNo === shown.versionNo) : undefined;
  const options = [
    ...(draft ? [{ value: 'draft', label: `Draft ${draft.ordinal} (not saved)` }] : []),
    ...detail.versions.map((candidate) => ({ value: String(candidate.versionNo), label: `Version ${candidate.versionNo}${candidate.isLatest ? ' (latest)' : ''}` })),
  ];
  if (options.length === 0 && !sources) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {version ? <span className="text-xs text-muted-foreground max-lg:hidden">{versionSourceLabel(version.source)}</span> : null}
      {options.length > 0 ? (
        <OptionSelect
          value={shown.kind === 'version' ? String(shown.versionNo) : 'draft'}
          options={options}
          onValueChange={(value) => onVersion(value === 'draft' ? null : Number(value))}
          // On a phone the select gives way, so the row still ends in Download PDF with the comparison's toggle in it.
          triggerProps={{ 'aria-label': 'Version', className: 'w-48 max-md:min-w-32 max-md:flex-1' }}
        />
      ) : null}
      {sources}
      {compare}
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

/** What the paper's pane says while there is no version and no draft to show. */
function NoPaperYet({ generating }: { generating: boolean }) {
  return (
    <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      {generating ? 'The paper appears here when it is ready.' : 'No paper yet. The assistant’s draft appears here as soon as it writes one.'}
    </p>
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
 * A viewer, and a paper whose exam has ended, read the paper's conversation
 * without a message box (and get the paper alone when there is none): there
 * is nothing they could ask to change. A first paper still being generated
 * from photos has no assistant yet: there is no paper to ask about.
 *
 * A paper made from photos can be read against them (*Compare with photos* in
 * the header, `?compare=1`): the paper's pane then holds the photographed
 * page beside the paper ({@link PaperStage}), and the assistant folds into its
 * strip so both are wide enough to read (`assistantCollapsedOf`; it can be
 * opened again, and it is as it was left once the comparison ends).
 */
export function QuestionPaperStudio({
  scope,
  detail,
  canManage,
  chatId,
  versionParam,
  compare,
  uploads,
  heading,
  menu,
  notice,
  onVersion,
  onChat,
  onCompare,
  onOpenPhotos,
  onOpenSources,
}: {
  scope: QuestionPaperScope;
  detail: QuestionPaperDetail;
  canManage: boolean;
  /** The paper's conversation, from the address; null when none was started yet. */
  chatId: string | null;
  /** The version the address names (unchecked); null shows the newest thing. */
  versionParam: string | null;
  /** The address asks for the paper beside its photos (`?compare=1`); shown only when the paper can be compared. */
  compare: boolean;
  /** The paper's upload queue, owned above the views: a page is not turned while a photo is still on its way. */
  uploads: PageUploads;
  /** The paper's name and status, and its menu: the ends of the header row. */
  heading: ReactNode;
  menu: ReactNode;
  /** Why the paper cannot be changed, when it cannot; shown under the header. */
  notice: ReactNode;
  onVersion: (versionNo: number | null) => void;
  onChat: (chatId: string | null) => void;
  onCompare: (on: boolean) => void;
  onOpenPhotos: () => void;
  /** Opens the paper's photos card; null when there is nothing there for this user (no photos, and they may not add any). */
  onOpenSources: (() => void) | null;
}) {
  const canAsk = canManage && !isPaperLocked(detail.paper);
  // The assistant's side is there when there is a conversation to read, or a saved paper this user may ask about.
  const showAssistant = chatId !== null || (canAsk && detail.paper.latestVersionNo > 0);
  const readOnlyReason = canAsk
    ? null
    : canManage
      ? 'This paper can no longer be changed, so nothing more can be asked here.'
      : 'You can read this conversation. Only people who can change this paper can write here.';
  const [assistantOpen, setAssistantOpen] = useState(false);
  // How the user left the assistant, and whether they opened it again during a comparison: two facts, so ending the comparison needs no restoring.
  const [assistantCollapsed, setAssistantCollapsed] = useState(false);
  const [assistantShownWhileComparing, setAssistantShownWhileComparing] = useState(false);
  const chatDraft = usePaperDraft(scope, showAssistant ? chatId : null, detail.paper);
  const draft = chatDraft && draftIsNewest(chatDraft.writtenAt, detail.versions) ? chatDraft : null;
  const { send, isPending: saving } = useSendAssistantMessage(scope.schoolId, PAPER_ASSISTANT_SURFACE);
  const shown = shownPaperOf(versionParam, detail.versions.map((version) => version.versionNo), draft !== null);
  const canCompare = canCompareOf({ pageCount: detail.pages.length, shown });
  const comparing = compare && canCompare;
  const collapsed = assistantCollapsedOf({ comparing, collapsed: assistantCollapsed, shownWhileComparing: assistantShownWhileComparing });
  /** Hiding or showing the assistant changes the fact of the view on screen: the comparison's own while comparing, the user's lasting choice otherwise. */
  const setCollapsed = (next: boolean) => (comparing ? setAssistantShownWhileComparing(!next) : setAssistantCollapsed(next));
  const toggleCompare = (on: boolean) => {
    // Every comparison starts with the assistant folded away, whatever was done during the last one.
    if (on) setAssistantShownWhileComparing(false);
    onCompare(on);
  };
  const saveDraft = () => {
    if (!draft || !chatId) return;
    // The approval that follows appears in the assistant, so a phone shows it.
    setAssistantOpen(true);
    setCollapsed(false);
    void send(draft.saveRequest, chatId).catch((error: unknown) => toast.error(requestErrorMessage(error, 'The save could not be requested.')));
  };
  return (
    // md+: cancels the shell's page padding and takes the window's remaining height. Phone: an ordinary page, with room for the assistant's bar.
    <div className={cn('flex min-w-0 flex-col gap-4 md:-m-6 md:gap-0 lg:-m-8', APP_SHELL_FILL_HEIGHT_MD_CLASS, showAssistant && 'max-md:pb-16')}>
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 md:border-b md:px-4 md:py-2.5">
        <div className="min-w-0 flex-1">{heading}</div>
        {/* On a phone the menu stays beside the name and the version row goes underneath. */}
        <div className="max-md:order-last max-md:basis-full">
          <PaperToolbar
            scope={scope}
            detail={detail}
            shown={shown}
            draft={draft}
            onVersion={onVersion}
            sources={
              onOpenSources ? (
                <SourcesButton label={detail.paper.pageCount > 0 ? 'View uploaded photos or file' : 'Add photos or a file'} onOpen={onOpenSources} />
              ) : null
            }
            compare={canCompare ? <CompareToggle on={comparing} onChange={toggleCompare} /> : null}
          />
        </div>
        {menu}
      </header>
      <div className={cn('grid min-h-0 min-w-0 flex-1', showAssistant && (collapsed ? 'md:grid-cols-[auto_minmax(0,1fr)]' : 'md:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]'))}>
        {showAssistant ? (
          <PaperAssistant
            scope={scope}
            chatId={chatId}
            readOnlyReason={readOnlyReason}
            canSeeHistory={canManage}
            open={assistantOpen}
            onOpenChange={setAssistantOpen}
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            draftOrdinal={draft ? draft.ordinal : null}
            onChat={onChat}
          />
        ) : null}
        <section aria-label="Paper" className="flex min-h-0 min-w-0 flex-col gap-3 md:overflow-hidden md:bg-muted/30 md:p-4">
          {notice}
          <GenerationNotice detail={detail} onOpenPhotos={onOpenPhotos} />
          <PaperStage photos={comparing ? <PaperPhotoCompare scope={scope} detail={detail} canManage={canManage} uploads={uploads} /> : null}>
            {shown.kind === 'draft' && draft && chatId ? (
              <UnsavedDraft
                scope={scope}
                chatId={chatId}
                draft={draft}
                nextVersionNo={detail.paper.latestVersionNo + 1}
                onSave={canAsk ? saveDraft : null}
                saving={saving}
              />
            ) : null}
            {shown.kind === 'version' ? <SavedVersion key={shown.versionNo} scope={scope} versionNo={shown.versionNo} /> : null}
            {shown.kind === 'nothing' ? <NoPaperYet generating={inFlightJob(detail.activeJob) !== null} /> : null}
          </PaperStage>
        </section>
      </div>
    </div>
  );
}

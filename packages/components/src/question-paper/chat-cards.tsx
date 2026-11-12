import { Button } from '@campuspilot/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@campuspilot/ui/components/collapsible';
import { ChevronDown, Download, FilePlus2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { AssistantViewFrame } from '../assistant/views/view-frame';
import { PlaceholderNote, RemovedList } from './paper-notices';
import { removedSummary } from './paper-notices-model';
import { summarizeProblems } from './paper-problems-model';
import type { DraftCardFacts } from './chat-cards-model';

/**
 * Question paper cards inside a chat (decision D32): a draft the assistant
 * wrote and a saved version. Presentational only: the data arrives as props
 * and every action is a callback (the chat reads the API and opens the
 * preview). A draft is only a draft until the user explicitly asks to save
 * it; "Save as new version" sends that request as a chat message.
 */

const MAX_LISTED_PROBLEMS = 3;

/**
 * Why a draft cannot be saved yet, in plain sentences (`summarizeProblems`).
 * The model reads the API's own lines and fixes them; a teacher gets the
 * sentences, and the original lines stay behind a collapsed "Details" list.
 * Long unbroken text wraps (`break-words`), so a 320px card does not scroll sideways.
 */
function ProblemList({ problems }: { problems: readonly string[] }) {
  const { sentences, details } = summarizeProblems(problems);
  const listed = sentences.slice(0, MAX_LISTED_PROBLEMS);
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm">
      <p className="font-medium text-destructive">This draft can’t be saved yet.</p>
      <ul aria-label="Problems" className="flex flex-col gap-1 break-words text-destructive">
        {listed.map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
        {sentences.length > listed.length ? <li className="text-muted-foreground">and {sentences.length - listed.length} more.</li> : null}
      </ul>
      <Details lines={details} />
    </div>
  );
}

/** The raw lines behind a collapsed "Details" disclosure: for the curious and for support, never the main text. */
function Details({ lines }: { lines: readonly string[] }) {
  return (
    <Collapsible className="flex min-w-0 flex-col gap-1">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="self-start text-muted-foreground">
          Details
          <ChevronDown data-icon="inline-end" aria-hidden />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul aria-label="Technical details" className="flex list-disc flex-col gap-1 pl-8 text-xs break-words text-muted-foreground">
          {lines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function CardActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export type QuestionPaperDraftCardProps = DraftCardFacts & {
  /** "Draft 2": its place among the drafts of this conversation. */
  ordinal: number;
  /** The Preview control (a trigger with its dialog); the chat supplies it because it reads the API. */
  preview: ReactNode;
  /** Sends "Save draft … as a new version."; absent while the chat cannot send. */
  onSave?: () => void;
  /** The user already asked to save this draft (a later message in the conversation says so): the button is spent, so a second click cannot queue a duplicate version. */
  saveRequested?: boolean;
  /**
   * "Draft 3": a later draft of the same paper was checked and is ready. The
   * card then shrinks to one quiet line, whether it was ready or not, so a
   * repaired draft's red card does not stay on screen; opening it shows the
   * draft as it was (a ready one can still be previewed and saved).
   */
  supersededBy?: number;
};

/** The quiet line a replaced draft shrinks to; opening it shows the draft. */
function SupersededDraft({ by, children }: { by: number; children: ReactNode }) {
  return (
    <Collapsible className="flex min-w-0 flex-col gap-2">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="self-start text-muted-foreground">
          Replaced by Draft {by}
          <ChevronDown data-icon="inline-end" aria-hidden />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** A draft question paper: valid or not, what was removed from its HTML, placeholder figures, a Preview and a quiet Save as new version. */
export function QuestionPaperDraftCard({
  ordinal,
  preview,
  onSave,
  saveRequested = false,
  supersededBy,
  ...facts
}: QuestionPaperDraftCardProps) {
  const body = <DraftBody facts={facts} preview={preview} onSave={onSave} saveRequested={saveRequested} />;
  return (
    <AssistantViewFrame title={`Draft ${ordinal}`}>
      {supersededBy ? <SupersededDraft by={supersededBy}>{body}</SupersededDraft> : body}
    </AssistantViewFrame>
  );
}

function DraftBody({
  facts,
  preview,
  onSave,
  saveRequested,
}: {
  facts: DraftCardFacts;
  preview: ReactNode;
  onSave?: () => void;
  saveRequested: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl assistant-well p-3">
      {facts.valid ? (
        <>
          <p className="text-sm">Ready to preview and save.</p>
          <PlaceholderNote count={facts.placeholderFigures} />
          <RemovedList lines={facts.removed} />
        </>
      ) : (
        <ProblemList problems={facts.problems} />
      )}
      {facts.valid ? (
        <CardActions>
          {preview}
          <Button type="button" variant="ghost" size="sm" onClick={onSave} disabled={!onSave || saveRequested}>
            <FilePlus2 data-icon="inline-start" aria-hidden /> {saveRequested ? 'Save requested' : 'Save as new version'}
          </Button>
        </CardActions>
      ) : null}
    </div>
  );
}

export type QuestionPaperVersionCardProps = {
  title?: string;
  /** "Science (Theory), Class 8", once known. */
  subtitle?: string;
  versionNo: number;
  /** How many sanitiser notices the version was saved with (the API's `warningCount`); their text is in the preview. */
  removedCount: number;
  isLatest: boolean;
  downloading: boolean;
  /** The Preview control (a trigger with its dialog). */
  preview: ReactNode;
  onDownload: () => void;
};

/** A saved version in the chat, with Preview and Download. Older versions can be previewed too. Its marks are not shown: the paper is HTML and nothing adds them up. */
export function QuestionPaperVersionCard({
  title,
  subtitle,
  versionNo,
  removedCount,
  isLatest,
  downloading,
  preview,
  onDownload,
}: QuestionPaperVersionCardProps) {
  return (
    <AssistantViewFrame title={title ?? `Question paper, version ${versionNo}`}>
      <div className="flex flex-col gap-3 rounded-xl assistant-well p-3">
        <p className="text-sm text-muted-foreground">
          {subtitle ? `${subtitle} · ` : null}
          Version {versionNo}
          {isLatest ? ' (latest)' : ''}
        </p>
        {removedCount > 0 ? (
          <p className="text-sm text-muted-foreground">Saved with {removedSummary(removedCount)}, see the preview.</p>
        ) : null}
        <CardActions>
          {preview}
          <Button type="button" variant="outline" size="sm" onClick={onDownload} disabled={downloading}>
            <Download data-icon="inline-start" aria-hidden /> {downloading ? 'Preparing…' : 'Download PDF'}
          </Button>
        </CardActions>
      </div>
    </AssistantViewFrame>
  );
}

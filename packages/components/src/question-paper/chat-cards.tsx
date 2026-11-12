import { Button } from '@campuspilot/ui/components/button';
import { Download, FilePlus2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { AssistantViewFrame } from '../assistant/views/view-frame';
import { PlaceholderNote, RemovedList } from './paper-notices';
import { removedSummary } from './paper-notices-model';
import type { DraftCardFacts } from './chat-cards-model';

/**
 * Question paper cards inside a chat (decision D32): a draft the assistant
 * wrote and a saved version. Presentational only: the data arrives as props
 * and every action is a callback (the chat reads the API and opens the
 * preview). A draft is only a draft until the user explicitly asks to save
 * it; "Save as new version" sends that request as a chat message.
 */

const MAX_LISTED_PROBLEMS = 3;

/** Why a draft cannot be saved yet, in the assistant's own sentences. The assistant reads the same list and fixes them. */
function ProblemList({ problems }: { problems: readonly string[] }) {
  const listed = problems.slice(0, MAX_LISTED_PROBLEMS);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="font-medium text-destructive">This draft can’t be saved yet.</p>
      <ul aria-label="Problems" className="flex flex-col gap-1 text-destructive">
        {listed.map((problem, index) => (
          <li key={`${index}-${problem}`}>{problem}</li>
        ))}
        {problems.length > listed.length ? (
          <li className="text-muted-foreground">and {problems.length - listed.length} more. The assistant will fix them.</li>
        ) : null}
      </ul>
    </div>
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
};

/** A draft question paper: valid or not, what was removed from its HTML, placeholder figures, a Preview and a quiet Save as new version. */
export function QuestionPaperDraftCard({ ordinal, preview, onSave, saveRequested = false, ...facts }: QuestionPaperDraftCardProps) {
  return (
    <AssistantViewFrame title={`Draft ${ordinal}`}>
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
    </AssistantViewFrame>
  );
}

export type QuestionPaperVersionCardProps = {
  title?: string;
  /** "Science (Theory), Class 8", once known. */
  subtitle?: string;
  versionNo: number;
  /** How many items the sanitiser removed when the version was saved; their text is in the preview. */
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
        {removedCount > 0 ? <p className="text-sm text-muted-foreground">{removedSummary(removedCount)} when it was saved, see the preview.</p> : null}
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

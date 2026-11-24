import { Button } from '@campuspilot/ui/components/button';
import { Check, Eye, Replace, Save } from 'lucide-react';

import { AssistantViewFrame } from '../assistant/views/view-frame';

/**
 * Where a template draft stands for the editor beside the chat:
 * - `shown`: it is what the editor holds and previews now;
 * - `available`: an earlier or hand-replaced proposal that can be shown again;
 * - `held`: the newest proposal, kept out of the editor because the person
 *   changed the template after sending their message; showing it replaces
 *   those changes, so it is offered as "Replace my edits";
 * - `saved-before`: proposed before the template was last saved;
 * - `elsewhere`: the chat is not beside an editor of this template (the
 *   assistant's own page, or another school's or type's editor), so it can
 *   only be described.
 */
export type TemplateDraftCardStatus = 'shown' | 'available' | 'held' | 'saved-before' | 'elsewhere';

const STATUS_TEXT: Record<TemplateDraftCardStatus, string> = {
  shown: 'Shown in the editor and its preview. Save it there to keep it.',
  available: 'Ready. Show it in the editor to look at it again.',
  held: 'Ready, but you changed the template while it was being written, so your edits are still in the editor.',
  'saved-before': 'Proposed before the template was last saved.',
  elsewhere: 'Ready. Open the template editor to see and save it.',
};

/**
 * What a ready draft card offers, as a question paper's draft card does: the
 * draft in the editor (Show in editor, or "Shown in editor" once it is there)
 * and Save. A held draft offers only "Replace my edits", since saving it would
 * throw the person's edits away; a draft from before the last save, or one
 * away from its editor, offers nothing.
 */
function DraftCardActions({ status, onShow, onSave }: { status: TemplateDraftCardStatus; onShow: () => void; onSave?: () => void }) {
  if (status === 'held') {
    return (
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={onShow}>
        <Replace data-icon="inline-start" aria-hidden /> Replace my edits
      </Button>
    );
  }
  if (status !== 'shown' && status !== 'available') return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'shown' ? (
        <Button type="button" variant="ghost" size="sm" disabled>
          <Check data-icon="inline-start" aria-hidden /> Shown in editor
        </Button>
      ) : (
        <Button type="button" variant="ghost" size="sm" onClick={onShow}>
          <Eye data-icon="inline-start" aria-hidden /> Show in editor
        </Button>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={onSave} disabled={!onSave}>
        <Save data-icon="inline-start" aria-hidden /> Save
      </Button>
    </div>
  );
}

/**
 * A template the assistant proposed in the template editor's chat
 * (docs/document-system.md, "Edit with the assistant"). Presentational: the
 * chat reads the call and decides the status; "Show in editor" and Save are
 * callbacks (Save opens the editor's own save dialog on this draft).
 * A proposal that cannot be saved lists the reasons the check gave, which the
 * assistant is told to fix before it answers.
 */
export function TemplateDraftCard({
  ordinal,
  problems,
  status,
  onShow,
  onSave,
}: {
  /** "Draft 2": its place among the conversation's template drafts. */
  ordinal: number;
  /** Why it cannot be saved; null when it is ready. */
  problems: readonly string[] | null;
  status: TemplateDraftCardStatus;
  /** Loads this draft into the editor; offered only while it is `available` or `held`. */
  onShow?: () => void;
  /** Shows this draft in the editor and opens its save dialog; offered only while it is `shown` or `available`. */
  onSave?: () => void;
}) {
  return (
    <AssistantViewFrame title={`Draft ${ordinal}`}>
      <div className="flex flex-col gap-2 rounded-xl assistant-well p-3 text-sm">
        {problems ? (
          <>
            <p className="font-medium text-destructive">This draft can’t be saved yet.</p>
            <ul aria-label="Problems" className="flex flex-col gap-1 break-words text-destructive">
              {problems.map((problem, index) => (
                <li key={`${index}-${problem}`}>{problem}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>{STATUS_TEXT[status]}</p>
        )}
        {!problems && onShow ? <DraftCardActions status={status} onShow={onShow} onSave={onSave} /> : null}
      </div>
    </AssistantViewFrame>
  );
}

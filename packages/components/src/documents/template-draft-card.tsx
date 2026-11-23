import { Button } from '@campuspilot/ui/components/button';
import { Eye, Replace } from 'lucide-react';

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

/** What a ready draft card offers: show an available draft, or replace the person's edits with a held one; nothing otherwise. */
function DraftCardAction({ status, onShow }: { status: TemplateDraftCardStatus; onShow: () => void }) {
  if (status === 'available') {
    return (
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onShow}>
        <Eye data-icon="inline-start" aria-hidden /> Show in editor
      </Button>
    );
  }
  if (status === 'held') {
    return (
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={onShow}>
        <Replace data-icon="inline-start" aria-hidden /> Replace my edits
      </Button>
    );
  }
  return null;
}

/**
 * A template the assistant proposed in the template editor's chat
 * (docs/document-system.md, "Edit with the assistant"). Presentational: the
 * chat reads the call and decides the status; "Show in editor" is a callback.
 * A proposal that cannot be saved lists the reasons the check gave, which the
 * assistant is told to fix before it answers.
 */
export function TemplateDraftCard({
  ordinal,
  problems,
  status,
  onShow,
}: {
  /** "Draft 2": its place among the conversation's template drafts. */
  ordinal: number;
  /** Why it cannot be saved; null when it is ready. */
  problems: readonly string[] | null;
  status: TemplateDraftCardStatus;
  /** Loads this draft into the editor; offered only while it is `available` or `held`. */
  onShow?: () => void;
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
        {!problems && onShow ? <DraftCardAction status={status} onShow={onShow} /> : null}
      </div>
    </AssistantViewFrame>
  );
}

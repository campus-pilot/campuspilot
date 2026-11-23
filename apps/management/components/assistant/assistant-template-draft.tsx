'use client';

import type { AssistantTimelineRow } from '@campuspilot/components/assistant/timeline-model';
import { TemplateDraftCard, type TemplateDraftCardStatus } from '@campuspilot/components/documents/template-draft-card';
import { templateDraftsOf, type TemplateDraft } from '@campuspilot/components/documents/template-draft-model';

/**
 * What the template editor tells its chat about the drafts in it: where each
 * stands for the editor (shown, available, from before the last save) and how
 * to show one again. A chat without it (the assistant's own page) only
 * describes the drafts.
 */
export type TemplateDraftBinding = {
  statusOf: (draft: TemplateDraft) => TemplateDraftCardStatus;
  onShow: (draft: TemplateDraft) => void;
};

/** Shown when a proposal's stored verdict cannot be read: it is never loaded into the editor. */
const UNREADABLE = ['This draft could not be checked. Ask the assistant to propose it again.'];

/**
 * The card of one `validateDocumentTemplateDraft` call in the chat
 * (docs/document-system.md, "Edit with the assistant").
 */
export function AssistantTemplateDraftCard({
  rows,
  callId,
  binding,
}: {
  rows: readonly AssistantTimelineRow[];
  callId: string;
  binding?: TemplateDraftBinding;
}) {
  const draft = templateDraftsOf(rows).find((candidate) => candidate.callId === callId);
  if (!draft) return null;
  const problems = draft.result ? (draft.result.valid ? null : draft.result.problems) : UNREADABLE;
  return (
    <TemplateDraftCard
      ordinal={draft.ordinal}
      problems={problems}
      status={binding ? binding.statusOf(draft) : 'elsewhere'}
      onShow={binding ? () => binding.onShow(draft) : undefined}
    />
  );
}

import type { ApprovalFacts } from '@campuspilot/components/assistant/approval-summaries';
import { approvalDraftId } from '@campuspilot/components/assistant/approval-summaries';
import type { AssistantTimelineRow } from '@campuspilot/components/assistant/timeline-model';
import { draftOrdinalOf, type DraftCallInput, type DraftResult } from '@campuspilot/components/question-paper/chat-cards-model';

/**
 * Pure decisions behind the question paper cards in the chat
 * (`assistant-question-paper.tsx`), kept out of the components so they can be
 * tested without a browser.
 */

/** The names a paper is known by, as `getQuestionPaperDetail` returns them. */
export type PaperNames = { subjectName: string; modeName: string; className: string; examName: string };

/** "Mathematics (Oral), Class 5, Annual Examination": how a paper is named in a sentence, a subtitle and the save request. */
export const paperLabelOf = (paper: PaperNames) => `${paper.subjectName} (${paper.modeName}), ${paper.className}, ${paper.examName}`;

/**
 * The name the save request uses before the paper's names are known, or when
 * they cannot be read: the slugs the draft was written for. It is still the
 * paper's own key, so the request names the right paper; only the words are plainer.
 */
export const paperLabelFromKey = (input: Pick<DraftCallInput, 'subjectSlug' | 'modeSlug' | 'examSlug'>) =>
  `${input.subjectSlug} (${input.modeSlug}), ${input.examSlug}`;

/** What a draft card can show. */
export type DraftCheck =
  /** The stored input is not a draft call (an older format): nothing to show. */
  | { state: 'unreadable' }
  /** The stored result was cut and the re-check is running. */
  | { state: 'checking' }
  /** The re-check failed (role changed, paper deleted, network): shown with a retry, never an endless skeleton. */
  | { state: 'failed' }
  | { state: 'ready'; result: DraftResult };

/**
 * The draft card's state from what the call stored and what its re-check
 * returned. A trusted stored result wins and the re-check never runs for it;
 * a failed re-check without data is `failed`, a held result wins over a later failed refetch.
 */
export function draftCheckOf({
  input,
  stored,
  recheck,
}: {
  input: DraftCallInput | null;
  stored: DraftResult | null;
  recheck: { data: DraftResult | undefined; isError: boolean };
}): DraftCheck {
  if (!input) return { state: 'unreadable' };
  const result = stored ?? recheck.data;
  if (result) return { state: 'ready', result };
  return recheck.isError ? { state: 'failed' } : { state: 'checking' };
}

/**
 * The facts the approval summary of a tool needs, from the conversation and
 * the paper's names (null while they load): the draft ordinal when the input
 * names a draft id the chat holds a card for.
 */
export function approvalFactsOf({
  toolName,
  input,
  rows,
  paper,
}: {
  toolName: string;
  input: unknown;
  rows: readonly AssistantTimelineRow[];
  paper: PaperNames | null;
}): ApprovalFacts {
  const draftId = approvalDraftId(toolName, input);
  return { paperLabel: paper ? paperLabelOf(paper) : null, draftOrdinal: draftId ? draftOrdinalOf(rows, draftId) : null };
}

/**
 * Whether the paper a seed names could not be read: only when nothing was
 * ever read and the request failed. A refetch that fails while the paper is
 * held (a network blip on window focus) keeps the seed, so a conversation
 * started on the paper's screen is still seeded and shared with it.
 */
export const seedFailedOf = (query: { hasSeed: boolean; hasData: boolean; isError: boolean }) => query.hasSeed && !query.hasData && query.isError;

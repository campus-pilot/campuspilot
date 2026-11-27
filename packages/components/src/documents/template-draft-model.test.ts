import { describe, expect, it } from 'vitest';

import type { AssistantTimelineRow } from '../assistant/timeline-model';
import { isPaperDraftCard, unsavedDraftOf } from '../question-paper/chat-cards-model';
import {
  adoptShownSource,
  draftBelongsTo,
  editorSourceOf,
  lastKnownSourceOf,
  latestTemplateDraftOf,
  parseTemplateDraftResult,
  sourceToSend,
  templateDraftStatusOf,
  templateDraftsOf,
  type TemplateWorkingCopy,
} from './template-draft-model';

const ready = { valid: true, problems: [], draftId: 'abcdefabcdef', characters: 10 };
const invalid = { valid: false, problems: ['Template syntax is invalid.'], draftId: null, characters: 10 };

const card = (id: string, content: string, output: unknown, at: string, documentType = 'bill', schoolId = 's') =>
  ({
    kind: 'card',
    id,
    card: 'document_template_draft',
    call: {
      id,
      kind: 'tool_call',
      status: 'succeeded',
      createdAt: new Date(at),
      body: {
        toolName: 'school.validateDocumentTemplateDraft',
        input: { schoolId, documentType, content },
        output: JSON.stringify(output),
        outputTruncated: false,
      },
    },
  }) as unknown as AssistantTimelineRow;

const userMessage = (id: string, editorSource?: { documentType: string; content: string }) =>
  ({ kind: 'user', id, item: { id, kind: 'user_message', body: { text: 'Change it', ...(editorSource ? { editorSource } : {}) } } }) as unknown as AssistantTimelineRow;

describe('template drafts of a conversation', () => {
  const rows = [
    card('a', '<p>1</p>', ready, '2026-11-20T10:00:00Z'),
    card('b', '<p>2</p>', invalid, '2026-11-20T10:01:00Z'),
    card('c', '<p>3</p>', ready, '2026-11-20T10:02:00Z', 'receipt'),
  ];

  it('numbers every proposal and reads its verdict, wrapped or not', () => {
    const drafts = templateDraftsOf(rows);
    expect(drafts.map((draft) => [draft.callId, draft.ordinal])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
    expect(parseTemplateDraftResult(JSON.stringify({ structuredContent: ready }), false)).toEqual(ready);
    // A cut or unreadable verdict is never trusted.
    expect(parseTemplateDraftResult(JSON.stringify(ready), true)).toBeNull();
    expect(parseTemplateDraftResult('not json', false)).toBeNull();
  });

  it('offers the newest ready draft of the type, proposed after the last save', () => {
    const drafts = templateDraftsOf(rows);
    expect(latestTemplateDraftOf(drafts, { schoolId: 's', documentType: 'bill', savedAt: new Date('2026-11-20T09:00:00Z') })?.callId).toBe('a');
    // The invalid newer draft does not count, and a draft from before the save is history.
    expect(latestTemplateDraftOf(drafts, { schoolId: 's', documentType: 'bill', savedAt: new Date('2026-11-20T10:00:30Z') })).toBeNull();
    expect(latestTemplateDraftOf(drafts, { schoolId: 's', documentType: 'receipt', savedAt: new Date(0) })?.callId).toBe('c');
  });

  it('never offers a draft of another school or type to this editor, and only describes it', () => {
    const drafts = templateDraftsOf([...rows, card('d', '<p>other</p>', ready, '2026-11-20T10:03:00Z', 'bill', 'other-school')]);
    expect(latestTemplateDraftOf(drafts, { schoolId: 's', documentType: 'bill', savedAt: new Date(0) })?.callId).toBe('a');
    const other = drafts.find((draft) => draft.callId === 'd')!;
    const receipt = drafts.find((draft) => draft.callId === 'c')!;
    expect(draftBelongsTo(other, { schoolId: 's', documentType: 'bill' })).toBe(false);
    const source = { content: '<p>saved</p>', draft: null, held: null };
    for (const draft of [other, receipt]) {
      expect(templateDraftStatusOf(draft, { scope: { schoolId: 's', documentType: 'bill' }, source, savedAt: new Date(0) })).toBe('elsewhere');
    }
  });

  it('is never counted as a question paper draft', () => {
    expect(rows.some(isPaperDraftCard)).toBe(false);
    expect(unsavedDraftOf(rows, { sessionId: 'ss', examSlug: 'e', classId: 'c', subjectSlug: 'su', modeSlug: 'm' })).toBeNull();
  });
});

describe('the source the editor holds', () => {
  const [draft] = templateDraftsOf([card('a', '<p>AI</p>', ready, '2026-11-20T10:00:00Z')]);
  const copy = (fields: Partial<TemplateWorkingCopy>): TemplateWorkingCopy => ({ content: '<p>saved</p>', edited: false, over: null, editedSinceSend: false, ...fields });

  it('shows a new draft over the working copy until the person edits it', () => {
    expect(editorSourceOf(copy({}), draft!)).toEqual({ content: '<p>AI</p>', draft, held: null });
    // A hand edit made while this draft was the newest keeps the hand edit.
    expect(editorSourceOf(copy({ content: '<p>mine</p>', over: 'a', edited: true, editedSinceSend: true }), draft!)).toEqual({ content: '<p>mine</p>', draft: null, held: null });
    // A hand edit the person sent with their message is in the draft: the draft replaces it.
    expect(editorSourceOf(copy({ content: '<p>mine</p>', edited: true }), draft!)).toEqual({ content: '<p>AI</p>', draft, held: null });
    expect(editorSourceOf(copy({}), null)).toEqual({ content: '<p>saved</p>', draft: null, held: null });
  });

  it('holds a draft back, never showing it by itself, when the person edited after sending', () => {
    // Sent, then kept typing while the assistant worked: the arriving draft would discard those edits.
    const typedAfterSend = copy({ content: '<p>mine, typed after sending</p>', edited: true, editedSinceSend: true });
    const shown = editorSourceOf(typedAfterSend, draft!);
    expect(shown).toEqual({ content: '<p>mine, typed after sending</p>', draft: null, held: draft });
    expect(templateDraftStatusOf(draft!, { scope: { schoolId: 's', documentType: 'bill' }, source: shown, savedAt: new Date(0) })).toBe('held');
    // "Replace my edits" chooses the draft: then it is the working copy, and further typing keeps further edits.
    const replaced = copy({ content: draft!.content, edited: true, over: 'a' });
    expect(editorSourceOf(replaced, draft!)).toEqual({ content: '<p>AI</p>', draft: null, held: null });
    expect(templateDraftStatusOf(draft!, { scope: { schoolId: 's', documentType: 'bill' }, source: editorSourceOf(replaced, draft!), savedAt: new Date(0) })).toBe('shown');
  });

  it('keeps a shown draft on screen as the working copy when the chat that holds it goes away (New chat)', () => {
    const manual = copy({ content: '<p>mine</p>', edited: true });
    const shown = editorSourceOf(manual, draft!);
    expect(shown.draft).toBe(draft);
    const kept = adoptShownSource(manual, shown);
    // The new chat has no drafts: the editor still shows the draft's source, as unsaved work.
    expect(editorSourceOf(kept, null)).toEqual({ content: '<p>AI</p>', draft: null, held: null });
    // Nothing shown from a draft: the working copy is left alone.
    expect(adoptShownSource(manual, editorSourceOf(manual, null))).toBe(manual);
  });

  it('sends the source only when the conversation has not seen it', () => {
    const rows = [userMessage('u1', { documentType: 'bill', content: '<p>sent</p>' }), card('a', '<p>AI</p>', ready, '2026-11-20T10:00:00Z')];
    expect(lastKnownSourceOf([], 'bill')).toBeNull();
    expect(lastKnownSourceOf(rows, 'bill')).toBe('<p>AI</p>');
    expect(lastKnownSourceOf([rows[1]!, userMessage('u2', { documentType: 'bill', content: '<p>hand</p>' })], 'bill')).toBe('<p>hand</p>');
    // An invalid draft is not what the editor holds.
    expect(lastKnownSourceOf([rows[0]!, card('b', '<p>bad</p>', invalid, '2026-11-20T10:00:00Z')], 'bill')).toBe('<p>sent</p>');
    expect(sourceToSend({ current: '<p>AI</p>', lastKnown: '<p>AI</p>' })).toBeNull();
    expect(sourceToSend({ current: '<p>edited</p>', lastKnown: '<p>AI</p>' })).toBe('<p>edited</p>');
    expect(sourceToSend({ current: '<p>first</p>', lastKnown: null })).toBe('<p>first</p>');
  });
});

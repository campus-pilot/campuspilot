import { describe, expect, it } from 'vitest';

import type { AssistantTimelineRow } from '../assistant/timeline-model';
import { isPaperDraftCard, unsavedDraftOf } from '../question-paper/chat-cards-model';
import {
  editorSourceOf,
  lastKnownSourceOf,
  latestTemplateDraftOf,
  parseTemplateDraftResult,
  sourceToSend,
  templateDraftsOf,
} from './template-draft-model';

const ready = { valid: true, problems: [], draftId: 'abcdefabcdef', characters: 10 };
const invalid = { valid: false, problems: ['Template syntax is invalid.'], draftId: null, characters: 10 };

const card = (id: string, content: string, output: unknown, at: string, documentType = 'bill') =>
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
        input: { schoolId: 's', documentType, content },
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
    expect(latestTemplateDraftOf(drafts, { documentType: 'bill', savedAt: new Date('2026-11-20T09:00:00Z') })?.callId).toBe('a');
    // The invalid newer draft does not count, and a draft from before the save is history.
    expect(latestTemplateDraftOf(drafts, { documentType: 'bill', savedAt: new Date('2026-11-20T10:00:30Z') })).toBeNull();
    expect(latestTemplateDraftOf(drafts, { documentType: 'receipt', savedAt: new Date(0) })?.callId).toBe('c');
  });

  it('is never counted as a question paper draft', () => {
    expect(rows.some(isPaperDraftCard)).toBe(false);
    expect(unsavedDraftOf(rows, { sessionId: 'ss', examSlug: 'e', classId: 'c', subjectSlug: 'su', modeSlug: 'm' })).toBeNull();
  });
});

describe('the source the editor holds', () => {
  const [draft] = templateDraftsOf([card('a', '<p>AI</p>', ready, '2026-11-20T10:00:00Z')]);

  it('shows a new draft over the working copy until the person edits it', () => {
    expect(editorSourceOf({ content: '<p>saved</p>', over: null, edited: false }, draft!)).toEqual({ content: '<p>AI</p>', draft });
    // A hand edit made while this draft was the newest keeps the hand edit.
    expect(editorSourceOf({ content: '<p>mine</p>', over: 'a', edited: true }, draft!)).toEqual({ content: '<p>mine</p>', draft: null });
    // A hand edit made before this draft arrived gives way to it.
    expect(editorSourceOf({ content: '<p>mine</p>', over: null, edited: true }, draft!)).toEqual({ content: '<p>AI</p>', draft });
    expect(editorSourceOf({ content: '<p>saved</p>', over: null, edited: false }, null)).toEqual({ content: '<p>saved</p>', draft: null });
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

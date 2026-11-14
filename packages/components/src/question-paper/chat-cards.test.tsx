// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssistantTimelineRow } from '../assistant/timeline-model';
import { QuestionPaperDraftCard, QuestionPaperVersionCard } from './chat-cards';
import {
  draftFactsOf,
  draftCallsNeedingRecheck,
  draftOrdinalOf,
  draftSaveSpent,
  parseDraftCallInput,
  parseStoredDraftResult,
  saveDraftMessage,
  supersededDrafts,
  unsavedDraftOf,
  type DraftResult,
} from './chat-cards-model';

afterEach(cleanup);

const valid: DraftResult = {
  valid: true,
  problems: [],
  stripped: ['The event handler "onclick" was removed'],
  draftId: 'abc123def456',
  placeholderFigures: 2,
};
const invalid: DraftResult = {
  valid: false,
  problems: ['Formula 1 (\\frac{1): Invalid TeX'],
  stripped: [],
  draftId: null,
  placeholderFigures: 0,
};

describe('reading a draft check from its tool call', () => {
  it('reads the stored output, raw or wrapped, and refuses a cut or foreign one', () => {
    expect(parseStoredDraftResult(JSON.stringify(valid), false)).toEqual(valid);
    expect(parseStoredDraftResult(JSON.stringify({ structuredContent: valid }), false)).toEqual(valid);
    expect(parseStoredDraftResult(JSON.stringify(valid).slice(0, 40), true)).toBeNull();
    expect(parseStoredDraftResult('not json', false)).toBeNull();
    expect(parseStoredDraftResult('{"valid":true}', false)).toBeNull();
    expect(parseStoredDraftResult(undefined, undefined)).toBeNull();
  });

  it('reads the paper key and document back from the stored input', () => {
    const input = { schoolId: 's', sessionId: 'ss', examSlug: 'e', classId: 'c', subjectSlug: 'su', modeSlug: 'm', html: '<p>Q1</p>' };
    expect(parseDraftCallInput(input)).toEqual(input);
    expect(parseDraftCallInput({ ...input, html: undefined })).toBeNull();
    expect(parseDraftCallInput({ schoolId: 's' })).toBeNull();
    expect(parseDraftCallInput(null)).toBeNull();
  });

  it('is a valid draft only with a draft id, and says something for an invalid one with no errors', () => {
    expect(draftFactsOf(valid)).toMatchObject({ valid: true, draftId: 'abc123def456' });
    expect(draftFactsOf({ ...valid, draftId: null })).toMatchObject({ valid: false });
    expect(draftFactsOf({ ...invalid, problems: [] })).toMatchObject({ valid: false, problems: ['This draft is not valid.'] });
  });

  it('asks to save a draft by its id and names the paper, because the id is a hash of the text alone', () => {
    expect(saveDraftMessage('abc123def456', 'Mathematics (Oral), Class 5, Annual Examination')).toBe(
      'Save draft abc123def456 as a new version of Mathematics (Oral), Class 5, Annual Examination.',
    );
  });
});

describe('QuestionPaperDraftCard', () => {
  it('keeps what the sanitiser removed behind a collapsed list, shows placeholder figures, with Preview and a quiet Save and no marks', () => {
    const onSave = vi.fn();
    render(
      <QuestionPaperDraftCard ordinal={2} {...draftFactsOf(valid)} preview={<button type="button">Preview</button>} onSave={onSave} />,
    );
    expect(screen.getByRole('heading', { name: 'Draft 2' })).toBeTruthy();
    expect(screen.queryByText(/event handler "onclick" was removed/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /1 notice/ }));
    expect(screen.getByText(/event handler "onclick" was removed/)).toBeTruthy();
    expect(screen.queryByText(/marks/i)).toBeNull();
    expect(screen.getByText(/2 figures are still a placeholder/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save as new version' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('cannot be saved while the chat cannot send', () => {
    render(<QuestionPaperDraftCard ordinal={1} {...draftFactsOf(valid)} preview={null} />);
    expect((screen.getByRole('button', { name: 'Save as new version' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('spends the Save button once the user already asked to save the draft', () => {
    const onSave = vi.fn();
    render(<QuestionPaperDraftCard ordinal={1} {...draftFactsOf(valid)} preview={null} onSave={onSave} saveRequested />);
    const button = screen.getByRole('button', { name: 'Save requested' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('lists the problems of an invalid draft and offers neither preview nor save', () => {
    render(<QuestionPaperDraftCard ordinal={1} {...draftFactsOf(invalid)} preview={<button type="button">Preview</button>} />);
    expect(screen.getByText('This draft can’t be saved yet.')).toBeTruthy();
    expect(screen.getByText('Formula 1 could not be typeset.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save as new version' })).toBeNull();
  });

  it('keeps the raw KaTeX text out of the main text, behind a collapsed Details list', () => {
    render(<QuestionPaperDraftCard ordinal={1} {...draftFactsOf(invalid)} preview={null} />);
    expect(screen.queryByText(/Invalid TeX/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText(/Formula 1 .*Invalid TeX/)).toBeTruthy();
  });

  it('shrinks a replaced draft to one quiet line that opens the draft as it was', () => {
    render(<QuestionPaperDraftCard ordinal={1} {...draftFactsOf(invalid)} preview={null} supersededBy={2} />);
    expect(screen.queryByText('This draft can’t be saved yet.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Replaced by Draft 2/ }));
    expect(screen.getByText('This draft can’t be saved yet.')).toBeTruthy();
  });

  it('keeps a requested Save visible outside the collapsed replaced draft, and names the draft for a screen reader', () => {
    render(<QuestionPaperDraftCard ordinal={1} {...draftFactsOf(valid)} preview={null} supersededBy={2} saveRequested />);
    expect(screen.getByText('Save requested for this draft')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Draft 1: Replaced by Draft 2' })).toBeTruthy();
    cleanup();
    render(<QuestionPaperDraftCard ordinal={1} {...draftFactsOf(valid)} preview={null} supersededBy={2} />);
    expect(screen.queryByText('Save requested for this draft')).toBeNull();
  });
});

const call = (id: string, html: string, output: unknown, scope = 'e1') =>
  ({
    kind: 'card',
    id,
    card: 'question_paper_draft',
    call: {
      id,
      kind: 'tool_call',
      status: 'succeeded',
      body: {
        toolName: 'school.validateQuestionPaperDraft',
        input: { schoolId: 's', sessionId: 'ss', examSlug: scope, classId: 'c', subjectSlug: 'su', modeSlug: 'm', html },
        output: JSON.stringify(output),
        outputTruncated: false,
      },
    },
  }) as unknown as AssistantTimelineRow;
const ready = (draftId: string): DraftResult => ({ ...valid, draftId });

describe('drafts of a conversation', () => {
  const rows = [
    call('a', '1', invalid),
    call('b', '2', ready('bbbbbbbbbbbb')),
    call('c', '3', ready('cccccccccccc'), 'other-exam'),
    call('d', '4', ready('dddddddddddd')),
  ];

  it('marks a draft replaced by the nearest later ready draft of the same paper only', () => {
    const replaced = supersededDrafts(rows);
    expect(replaced.get('a')).toBe(2);
    expect(replaced.get('b')).toBe(4);
    expect(replaced.has('c')).toBe(false);
    expect(replaced.has('d')).toBe(false);
  });

  it('does not count a later draft that is invalid or whose stored result is cut', () => {
    const cut = call('x', '5', ready('xxxxxxxxxxxx'));
    (cut as { call: { body: { outputTruncated: boolean } } }).call.body.outputTruncated = true;
    expect(supersededDrafts([call('a', '1', invalid), call('b', '2', invalid), cut]).size).toBe(0);
  });

  it('counts a later ready draft whose stored result was cut when its re-check verdict says ready', () => {
    const cut = call('x', '5', ready('xxxxxxxxxxxx'));
    (cut as { call: { body: { outputTruncated: boolean } } }).call.body.outputTruncated = true;
    const earlier = call('a', '1', invalid);
    expect(draftCallsNeedingRecheck([earlier, cut]).map(({ id }) => id)).toEqual(['x']);
    expect(supersededDrafts([earlier, cut], new Map([['x', ready('xxxxxxxxxxxx')]])).get('a')).toBe(2);
    // A re-check that says the later draft is not valid does not replace the earlier one.
    expect(supersededDrafts([earlier, cut], new Map([['x', invalid]])).size).toBe(0);
  });

  it('offers the newest ready draft of a paper as unsaved, until a save goes through after it', () => {
    const paper = { sessionId: 'ss', examSlug: 'e1', classId: 'c', subjectSlug: 'su', modeSlug: 'm' };
    expect(unsavedDraftOf(rows, paper)).toMatchObject({ callId: 'd', ordinal: 4, draftId: 'dddddddddddd', placeholderFigures: 2 });
    expect(unsavedDraftOf(rows, { ...paper, examSlug: 'other-exam' })).toMatchObject({ callId: 'c', ordinal: 3 });
    expect(unsavedDraftOf([call('a', '1', invalid)], paper)).toBeNull();

    const save = (status: string, saved: Record<string, string> = paper) =>
      ({ kind: 'approval', id: `s-${status}`, call: { id: `s-${status}`, status, body: { toolName: 'school.saveQuestionPaperVersion', input: { schoolId: 's', ...saved, expectedVersionNo: 0 } } } }) as unknown as AssistantTimelineRow;
    // Saving another paper in the same chat leaves this paper's draft unsaved.
    expect(unsavedDraftOf([...rows, save('succeeded', { ...paper, modeSlug: 'oral' })], paper)?.callId).toBe('d');
    // Saved: a version holds it now. A declined or failed save leaves it unsaved.
    expect(unsavedDraftOf([...rows, save('succeeded')], paper)).toBeNull();
    expect(unsavedDraftOf([...rows, save('declined')], paper)?.callId).toBe('d');
    // A draft written after the save is unsaved again; a folded save counts like a visible one.
    expect(unsavedDraftOf([...rows, save('succeeded'), call('e', '5', ready('eeeeeeeeeeee'))], paper)).toMatchObject({ callId: 'e', ordinal: 5 });
    const folded = { kind: 'work', id: 'w', folded: [save('succeeded')] } as unknown as AssistantTimelineRow;
    expect(unsavedDraftOf([...rows, folded], paper)).toBeNull();
  });

  it('reads a cut draft result from its re-check verdict', () => {
    const paper = { sessionId: 'ss', examSlug: 'e1', classId: 'c', subjectSlug: 'su', modeSlug: 'm' };
    const cut = call('x', '5', ready('xxxxxxxxxxxx'));
    (cut as { call: { body: { outputTruncated: boolean } } }).call.body.outputTruncated = true;
    expect(unsavedDraftOf([cut], paper)).toBeNull();
    expect(unsavedDraftOf([cut], paper, new Map([['x', ready('xxxxxxxxxxxx')]]))?.draftId).toBe('xxxxxxxxxxxx');
  });

  it('finds the ordinal of the newest draft with an id', () => {
    expect(draftOrdinalOf(rows, 'bbbbbbbbbbbb')).toBe(2);
    expect(draftOrdinalOf(rows, 'nope')).toBeNull();
  });
});

describe('QuestionPaperVersionCard', () => {
  it('names the version and what was removed, previews and downloads, and shows no marks', () => {
    const onDownload = vi.fn();
    render(
      <QuestionPaperVersionCard
        subtitle="Science (Theory), Class 8"
        versionNo={3}
        removedCount={1}
        isLatest={false}
        downloading={false}
        preview={<button type="button">Preview</button>}
        onDownload={onDownload}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Question paper, version 3' })).toBeTruthy();
    expect(screen.getByText('Science (Theory), Class 8 · Version 3')).toBeTruthy();
    expect(screen.getByText('Saved with 1 notice, see the preview.')).toBeTruthy();
    expect(screen.queryByText(/marks/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(onDownload).toHaveBeenCalled();
  });
});

describe('draftSaveSpent', () => {
  const sentence = saveDraftMessage('d1', 'Maths (Oral), Class 5, Annual');
  const ask = { kind: 'message', text: sentence } as const;
  it('is open before any request, for another draft and for the same draft on another paper', () => {
    expect(draftSaveSpent([], sentence)).toBe(false);
    expect(draftSaveSpent([ask], saveDraftMessage('d2', 'Maths (Oral), Class 5, Annual'))).toBe(false);
    expect(draftSaveSpent([ask], saveDraftMessage('d1', 'Maths (Oral), Class 6, Annual'))).toBe(false);
  });
  it('is spent from the request while the save is pending, approved or done', () => {
    expect(draftSaveSpent([ask], sentence)).toBe(true);
    for (const status of ['awaiting_approval', 'running', 'succeeded'] as const) {
      expect(draftSaveSpent([ask, { kind: 'save-call', status }], sentence)).toBe(true);
    }
  });
  it('opens again when the save was declined, cancelled or failed, and a new request spends it', () => {
    for (const status of ['declined', 'cancelled', 'failed'] as const) {
      expect(draftSaveSpent([ask, { kind: 'save-call', status }], sentence)).toBe(false);
    }
    expect(draftSaveSpent([ask, { kind: 'save-call', status: 'declined' }, ask], sentence)).toBe(true);
  });
});

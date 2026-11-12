// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QuestionPaperDraftCard, QuestionPaperVersionCard } from './chat-cards';
import {
  draftFactsOf,
  draftSaveSpent,
  parseDraftCallInput,
  parseStoredDraftResult,
  saveDraftMessage,
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
const invalid: DraftResult = { valid: false, problems: ['Formula 1 (\\frac{1): Invalid TeX'], stripped: [], draftId: null, placeholderFigures: 0 };

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

  it('asks to save a draft by its id', () => {
    expect(saveDraftMessage('abc123def456')).toBe('Save draft abc123def456 as a new version.');
  });
});

describe('QuestionPaperDraftCard', () => {
  it('keeps what the sanitiser removed behind a collapsed list, shows placeholder figures, with Preview and a quiet Save and no marks', () => {
    const onSave = vi.fn();
    render(<QuestionPaperDraftCard ordinal={2} {...draftFactsOf(valid)} preview={<button type="button">Preview</button>} onSave={onSave} />);
    expect(screen.getByRole('heading', { name: 'Draft 2' })).toBeTruthy();
    expect(screen.queryByText(/event handler "onclick" was removed/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /1 thing was removed/ }));
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
    expect(screen.getByText(/Formula 1 .*Invalid TeX/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save as new version' })).toBeNull();
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
    expect(screen.getByText('1 thing was removed when it was saved, see the preview.')).toBeTruthy();
    expect(screen.queryByText(/marks/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(onDownload).toHaveBeenCalled();
  });
});

describe('draftSaveSpent', () => {
  const ask = { kind: 'message', text: saveDraftMessage('d1') } as const;
  it('is open before any request and for another draft', () => {
    expect(draftSaveSpent([], 'd1')).toBe(false);
    expect(draftSaveSpent([ask], 'd2')).toBe(false);
  });
  it('is spent from the request while the save is pending, approved or done', () => {
    expect(draftSaveSpent([ask], 'd1')).toBe(true);
    for (const status of ['awaiting_approval', 'running', 'succeeded'] as const) {
      expect(draftSaveSpent([ask, { kind: 'save-call', status }], 'd1')).toBe(true);
    }
  });
  it('opens again when the save was declined, cancelled or failed, and a new request spends it', () => {
    for (const status of ['declined', 'cancelled', 'failed'] as const) {
      expect(draftSaveSpent([ask, { kind: 'save-call', status }], 'd1')).toBe(false);
    }
    expect(draftSaveSpent([ask, { kind: 'save-call', status: 'declined' }, ask], 'd1')).toBe(true);
  });
});

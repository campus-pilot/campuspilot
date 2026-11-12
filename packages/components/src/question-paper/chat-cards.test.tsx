// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QuestionPaperDraftCard, QuestionPaperVersionCard } from './chat-cards';
import {
  draftFactsOf,
  parseDraftCallInput,
  parseStoredDraftResult,
  saveDraftMessage,
  type DraftResult,
} from './chat-cards-model';

afterEach(cleanup);

const valid: DraftResult = {
  valid: true,
  errors: [],
  warnings: [{ code: 'total_differs_from_plan', path: '', message: 'The paper adds up to 15 marks but the plan says 20.' }],
  total: 15,
  planMaxMarks: 20,
  draftId: 'abc123def456',
  placeholderFigures: 2,
};
const invalid: DraftResult = { valid: false, errors: [{ path: 'sections[0].questions[1].marks', message: 'Marks are required.' }], warnings: [], total: null, planMaxMarks: 20, draftId: null, placeholderFigures: 0 };

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
    const input = { schoolId: 's', sessionId: 'ss', examSlug: 'e', classId: 'c', subjectSlug: 'su', modeSlug: 'm', content: { sections: [] } };
    expect(parseDraftCallInput(input)).toEqual(input);
    expect(parseDraftCallInput({ ...input, content: undefined })).toBeNull();
    expect(parseDraftCallInput({ schoolId: 's' })).toBeNull();
    expect(parseDraftCallInput(null)).toBeNull();
  });

  it('is a valid draft only with a draft id, and says something for an invalid one with no errors', () => {
    expect(draftFactsOf(valid)).toMatchObject({ valid: true, draftId: 'abc123def456', total: 15 });
    expect(draftFactsOf({ ...valid, draftId: null })).toMatchObject({ valid: false });
    expect(draftFactsOf({ ...invalid, errors: [] })).toMatchObject({ valid: false, errors: [{ message: 'This draft is not valid.' }] });
  });

  it('asks to save a draft by its id', () => {
    expect(saveDraftMessage('abc123def456')).toBe('Save draft abc123def456 as a new version.');
  });
});

describe('QuestionPaperDraftCard', () => {
  it('shows marks against the plan, warnings and placeholder figures, with Preview and a quiet Save', () => {
    const onSave = vi.fn();
    render(<QuestionPaperDraftCard ordinal={2} {...draftFactsOf(valid)} preview={<button type="button">Preview</button>} onSave={onSave} />);
    expect(screen.getByRole('heading', { name: 'Draft 2' })).toBeTruthy();
    expect(screen.getByText(/Total marks/)).toBeTruthy();
    expect(screen.getByText(/of 20 in the plan/)).toBeTruthy();
    expect(screen.getByText(/adds up to 15 marks/)).toBeTruthy();
    expect(screen.getByText(/2 figures are still a placeholder/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save as new version' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('cannot be saved while the chat cannot send', () => {
    render(<QuestionPaperDraftCard ordinal={1} {...draftFactsOf(valid)} preview={null} />);
    expect((screen.getByRole('button', { name: 'Save as new version' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists the problems of an invalid draft and offers neither preview nor save', () => {
    render(<QuestionPaperDraftCard ordinal={1} {...draftFactsOf(invalid)} preview={<button type="button">Preview</button>} />);
    expect(screen.getByText('sections[0].questions[1].marks: Marks are required.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save as new version' })).toBeNull();
  });
});

describe('QuestionPaperVersionCard', () => {
  it('names the version, marks and warnings, previews and downloads', () => {
    const onDownload = vi.fn();
    render(
      <QuestionPaperVersionCard
        subtitle="Science (Theory), Class 8"
        versionNo={3}
        totalMarks={20}
        planMaxMarks={20}
        warningCount={1}
        isLatest={false}
        downloading={false}
        preview={<button type="button">Preview</button>}
        onDownload={onDownload}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Question paper, version 3' })).toBeTruthy();
    expect(screen.getByText('Science (Theory), Class 8 · Version 3')).toBeTruthy();
    expect(screen.getByText('1 warning, see the preview.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(onDownload).toHaveBeenCalled();
  });
});

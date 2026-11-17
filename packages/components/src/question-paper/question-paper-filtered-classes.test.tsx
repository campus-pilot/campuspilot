// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installPopupDomStubs } from '../documents/combobox-test-setup';
import type { QuestionPaperClassView } from './question-paper-class-table';
import { QuestionPaperFilteredClasses } from './question-paper-filtered-classes';

beforeAll(installPopupDomStubs);
afterEach(cleanup);

const row = (modeSlug: string, modeName: string) => ({ modeSlug, modeName, maxMarks: 50, paper: null });

/** Class 8 has written and oral English; the exam has no practical mode. */
const classes: QuestionPaperClassView[] = [
  {
    classId: 'c8',
    className: 'Class 8',
    canManage: true,
    subjects: [{ subjectSlug: 'english', subjectName: 'English', modes: [row('written', 'Written'), row('oral', 'Oral')] }],
  },
];

function renderFiltered(props: { storedModes?: string[]; onStoredModesChange?: (slugs: string[]) => void; openClassId?: string | null; classes?: QuestionPaperClassView[] }) {
  const all = {
    classes: props.classes ?? classes,
    storedModes: props.storedModes ?? [],
    onStoredModesChange: props.onStoredModesChange ?? vi.fn(),
    openClassId: props.openClassId ?? 'c8',
    onOpenClassChange: vi.fn(),
    hrefOf: (cell: { classId: string; subjectSlug: string; modeSlug: string }) => `/p/${cell.classId}/${cell.subjectSlug}/${cell.modeSlug}`,
    onOpen: vi.fn(),
  };
  const view = render(<QuestionPaperFilteredClasses {...all} />);
  return { ...view, rerenderWith: (next: Partial<typeof all>) => view.rerender(<QuestionPaperFilteredClasses {...all} {...next} />) };
}

const openModeFilter = () => fireEvent.click(screen.getByRole('button', { name: 'Mode' }));
const pickMode = (name: string) => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name }));
const shownModes = () => screen.queryAllByRole('link').map((link) => link.getAttribute('href'));

describe('QuestionPaperFilteredClasses', () => {
  it('hands every change of the filter to the store, as the whole selection', () => {
    const onStoredModesChange = vi.fn();
    renderFiltered({ onStoredModesChange });
    openModeFilter();
    pickMode('Written');
    expect(onStoredModesChange).toHaveBeenLastCalledWith(['written']);
    pickMode('Oral');
    expect(onStoredModesChange).toHaveBeenLastCalledWith(['written', 'oral']);
  });

  it('keeps the selection and the open filter when re-rendered with the selection just stored', () => {
    let stored: string[] = [];
    const { rerenderWith } = renderFiltered({ onStoredModesChange: (slugs) => (stored = slugs) });
    openModeFilter();
    pickMode('Written');
    rerenderWith({ storedModes: stored });
    // The popover is still open and the class shows only the written paper.
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(shownModes()).toEqual(['/p/c8/english/written']);
    pickMode('Oral');
    expect(stored).toEqual(['written', 'oral']);
  });

  it('never resets a changed filter from its seed: only a remount reseeds it', () => {
    const { rerenderWith } = renderFiltered({});
    openModeFilter();
    pickMode('Written');
    // A different stored value without a remount (the caller keys the component for that) changes nothing.
    rerenderWith({ storedModes: ['oral'] });
    expect(shownModes()).toEqual(['/p/c8/english/written']);
  });

  it('ignores a stored mode this examination does not have, and keeps it when the filter changes', () => {
    const onStoredModesChange = vi.fn();
    renderFiltered({ storedModes: ['practical'], onStoredModesChange });
    // Nothing of this exam is selected, so every mode is shown and no badge appears.
    expect(shownModes()).toEqual(['/p/c8/english/written', '/p/c8/english/oral']);
    expect(screen.queryByRole('button', { name: /Remove filter/ })).toBeNull();
    openModeFilter();
    pickMode('Written');
    expect(onStoredModesChange).toHaveBeenLastCalledWith(['practical', 'written']);
  });

  it('says so when the filter hides every paper of the open class', () => {
    renderFiltered({ storedModes: ['written'], classes: [{ ...classes[0]!, subjects: [{ subjectSlug: 'english', subjectName: 'English', modes: [row('oral', 'Oral')] }] }, { ...classes[0]!, classId: 'c9', className: 'Class 9' }] });
    expect(screen.getByText('No papers match the selected modes.')).toBeTruthy();
  });

  it('leaves the filter out when the examination has no modes', () => {
    renderFiltered({ classes: [{ ...classes[0]!, subjects: [] }] });
    expect(screen.queryByRole('button', { name: 'Mode' })).toBeNull();
    expect(screen.getByText('This class has no subjects in the examination plan.')).toBeTruthy();
  });
});

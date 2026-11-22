// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installPopupDomStubs } from '../documents/combobox-test-setup';
import { QuestionPaperClassAccordion, type QuestionPaperAccordionClass } from './question-paper-class-accordion';

/** The class accordion of an examination's Question paper tab. */
beforeAll(() => {
  installPopupDomStubs();
  window.matchMedia ??= vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});
afterEach(cleanup);

describe('QuestionPaperClassAccordion', () => {
  const paperRow = (modeSlug: string, latestVersionNo = 0) => ({
    modeSlug,
    modeName: modeSlug,
    maxMarks: 50,
    paper: latestVersionNo ? { pageCount: 1, latestVersionNo, warningCount: 0, activeJob: null, lastJobFailure: null } : null,
  });
  const classes: QuestionPaperAccordionClass[] = [
    {
      classId: 'c1',
      className: 'Class 1',
      canManage: true,
      emptyReason: null,
      subjects: [{ subjectSlug: 'english', subjectName: 'English', modes: [paperRow('written', 1), paperRow('oral')] }],
    },
    { classId: 'c2', className: 'Class 2', canManage: false, emptyReason: 'no-matching-modes', subjects: [] },
    { classId: 'c3', className: 'Class 3', canManage: false, emptyReason: 'no-subjects', subjects: [] },
  ];
  const hrefOf = (cell: { classId: string; subjectSlug: string; modeSlug: string }) => `/p/${cell.classId}/${cell.subjectSlug}/${cell.modeSlug}`;
  const renderAccordion = (openClassId: string | null, onOpenClassChange = vi.fn()) =>
    render(
      <QuestionPaperClassAccordion
        classes={classes}
        openClassId={openClassId}
        onOpenClassChange={onOpenClassChange}
        hrefOf={hrefOf}
        onOpen={() => undefined}
      />,
    );

  it('shows every class collapsed with its summary when none is open', () => {
    renderAccordion(null);
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(3);
    expect(screen.getByRole('button', { name: /Class 1/ }).textContent).toContain('1 of 2 ready');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('opens only the named class; the closed ones keep no links in the document', () => {
    renderAccordion('c1');
    expect(screen.getByRole('button', { name: /Class 1/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/p/c1/english/written', '/p/c1/english/oral']);
  });

  it('says why an empty class is empty instead of counting nothing', () => {
    renderAccordion(null);
    expect(screen.getByRole('button', { name: /Class 2/ }).textContent).toContain('No matching papers');
    expect(screen.getByRole('button', { name: /Class 3/ }).textContent).toContain('No subjects');
    expect(screen.getByRole('button', { name: /Class 2/ }).textContent).not.toContain('0 of 0');
  });

  it('names the open class once: one region, holding a labelled table', () => {
    renderAccordion('c1');
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(screen.getByRole('table', { name: 'Class 1 question papers' })).toBeTruthy();
  });

  it('lets the open panel size itself, so rows the filter adds while it is open are not clipped', () => {
    const { container, rerender } = renderAccordion('c1');
    const grown = classes.map((classView) =>
      classView.classId === 'c1'
        ? { ...classView, subjects: [...classView.subjects, { subjectSlug: 'maths', subjectName: 'Maths', modes: [paperRow('written'), paperRow('oral')] }] }
        : classView,
    );
    rerender(<QuestionPaperClassAccordion classes={grown} openClassId="c1" onOpenClassChange={() => undefined} hrefOf={hrefOf} onOpen={() => undefined} />);
    expect(screen.getAllByRole('link')).toHaveLength(4);
    const panel = container.querySelector('[data-slot="accordion-content"] > div');
    expect(panel).not.toBeNull();
    // Radix measures the height only when the item opens; a wrapper pinned to that measure would clip the new rows.
    expect(panel!.className).not.toContain('--radix-accordion-content-height');
  });

  it('opens nothing, without an error, for an unknown class', () => {
    renderAccordion('someone-else');
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(3);
  });

  it('asks the caller to open a class and to close the open one', () => {
    const onOpenClassChange = vi.fn();
    renderAccordion('c1', onOpenClassChange);
    fireEvent.click(screen.getByRole('button', { name: /Class 2/ }));
    expect(onOpenClassChange).toHaveBeenLastCalledWith('c2');
    fireEvent.click(screen.getByRole('button', { name: /Class 1/ }));
    expect(onOpenClassChange).toHaveBeenLastCalledWith(null);
  });

  it('tells a class emptied by the filter apart from one empty by plan', () => {
    const { unmount } = renderAccordion('c2');
    expect(screen.getByText('No papers match the selected modes.')).toBeTruthy();
    unmount();
    renderAccordion('c3');
    expect(screen.getByText('This class has no subjects in the examination plan.')).toBeTruthy();
  });
});

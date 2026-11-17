// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SidebarMenu, SidebarProvider } from '@campuspilot/ui/components/sidebar';

import { installPopupDomStubs } from '../documents/combobox-test-setup';
import { QuestionPaperClassAccordion, type QuestionPaperAccordionClass } from './question-paper-class-accordion';
import {
  matchesClassName,
  QuestionPaperNavClasses,
  QuestionPaperNavCreateLink,
  QuestionPaperNavExams,
} from './question-paper-nav';

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

const inSidebar = (children: ReactNode) => (
  <SidebarProvider>
    <SidebarMenu>{children}</SidebarMenu>
  </SidebarProvider>
);

const exams = [
  { slug: 'periodic-test-1', name: 'Periodic Test 1' },
  { slug: 'annual', name: 'Annual Examination', detail: 'Completed' },
];

describe('QuestionPaperNavExams', () => {
  it('says when examinations are loading, could not be read, or there are none', () => {
    const onRetry = vi.fn();
    const { rerender } = render(inSidebar(<QuestionPaperNavExams exams={{ kind: 'pending' }} onRetry={onRetry} renderClasses={() => null} />));
    expect(screen.getByText('Loading examinations…')).toBeTruthy();

    rerender(inSidebar(<QuestionPaperNavExams exams={{ kind: 'failed', error: new Error('x') }} onRetry={onRetry} renderClasses={() => null} />));
    expect(screen.getByRole('alert').textContent).toContain('Examinations could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(inSidebar(<QuestionPaperNavExams exams={{ kind: 'ready', data: [], refetchError: null }} onRetry={onRetry} renderClasses={() => null} />));
    expect(screen.getByText('No examinations in this session')).toBeTruthy();
  });

  it('renders an examination’s classes only once it is opened, and the app’s footer', () => {
    const renderClasses = vi.fn((exam: { name: string }) => <p>Classes of {exam.name}</p>);
    render(
      inSidebar(
        <QuestionPaperNavExams
          exams={{ kind: 'ready', data: exams, refetchError: null }}
          onRetry={() => undefined}
          renderClasses={renderClasses}
          footer={<QuestionPaperNavCreateLink href="/settings/session/s1" />}
        />,
      ),
    );
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(renderClasses).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Periodic Test 1' }));
    expect(screen.getByText('Classes of Periodic Test 1')).toBeTruthy();
    expect(screen.queryByText('Classes of Annual Examination')).toBeNull();
    expect(screen.getByRole('link', { name: 'Add examination' }).getAttribute('href')).toBe('/settings/session/s1');
  });
});

describe('QuestionPaperNavClasses', () => {
  const classes = [
    { classId: 'c1', className: 'Class 1' },
    { classId: 'c8', className: 'Class 8' },
    { classId: 'nur', className: 'Nursery' },
  ];

  it('says when classes are loading, could not be read, or none may be opened', () => {
    const onRetry = vi.fn();
    const props = { examName: 'Annual', onRetry, onOpen: () => undefined };
    const { rerender } = render(inSidebar(<QuestionPaperNavClasses {...props} classes={{ kind: 'pending' }} />));
    expect(screen.getByText('Loading classes…')).toBeTruthy();

    rerender(inSidebar(<QuestionPaperNavClasses {...props} classes={{ kind: 'failed', error: new Error('x') }} />));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(inSidebar(<QuestionPaperNavClasses {...props} classes={{ kind: 'ready', data: [], refetchError: null }} />));
    expect(screen.getByText('No classes you can open')).toBeTruthy();
  });

  it('lists the classes, searches their names and opens the chosen one', () => {
    const onOpen = vi.fn();
    render(
      inSidebar(
        <QuestionPaperNavClasses examName="Annual" classes={{ kind: 'ready', data: classes, refetchError: null }} onRetry={() => undefined} onOpen={onOpen} />,
      ),
    );
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Class 1', 'Class 8', 'Nursery']);

    fireEvent.change(screen.getByRole('combobox', { name: 'Search classes of Annual' }), { target: { value: 'nurs' } });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Nursery']);

    fireEvent.click(screen.getByRole('option', { name: 'Nursery' }));
    expect(onOpen).toHaveBeenCalledWith('nur');
  });

  it('matches names only, never the ids used as values', () => {
    expect(matchesClassName('c8', 'class 8', ['Class 8'])).toBe(1);
    expect(matchesClassName('cls_abc', 'cls_', ['Class 8'])).toBe(0);
    expect(matchesClassName('c8', '', ['Class 8'])).toBe(1);
  });
});

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

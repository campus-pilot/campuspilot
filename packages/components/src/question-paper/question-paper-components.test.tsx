// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiBadge } from './ai-badge';
import { ContinueInChatLink } from './continue-in-chat-link';
import { GenerationStatus } from './generation-status';
import { hasFigurePlaceholders, MarksSummary } from './marks-summary';
import { PageThumbnailGrid, type PageThumbnailView } from './page-thumbnail-grid';
import { QuestionPaperClassTable, type QuestionPaperClassView } from './question-paper-class-table';
import { UploadQueue } from './upload-queue';
import { VersionList } from './version-list';

afterEach(cleanup);

const pages: PageThumbnailView[] = [
  { id: 'a', position: 1, originalName: 'one.jpg', byteSize: 2048, derivativeStatus: 'ready' },
  { id: 'b', position: 2, originalName: 'two.heic', byteSize: 3 * 1024 * 1024, derivativeStatus: 'unsupported' },
];

describe('AiBadge', () => {
  it('reads as "AI"', () => {
    render(<AiBadge />);
    expect(screen.getByText('AI')).toBeTruthy();
  });
});

describe('PageThumbnailGrid', () => {
  it('shows each page with a thumbnail, or a tile when none could be made', () => {
    render(<PageThumbnailGrid pages={pages} thumbUrl={(id) => `/thumb/${id}`} onReorder={() => {}} onDelete={() => {}} />);
    expect((screen.getByAltText('Page 1: one.jpg') as HTMLImageElement).getAttribute('src')).toBe('/thumb/a');
    expect(screen.queryByAltText('Page 2: two.heic')).toBeNull();
    expect(screen.getByText('Preview not available')).toBeTruthy();
    expect(screen.getByText('two.heic · 3 MB')).toBeTruthy();
  });

  it('asks to delete the page of the clicked tile', () => {
    const onDelete = vi.fn();
    render(<PageThumbnailGrid pages={pages} thumbUrl={() => ''} onReorder={() => {}} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete page 2' }));
    expect(onDelete).toHaveBeenCalledWith('b');
  });

  it('disables moving and deleting while changes are closed', () => {
    render(<PageThumbnailGrid pages={pages} thumbUrl={() => ''} disabled onReorder={() => {}} onDelete={() => {}} />);
    for (const name of ['Move page 1', 'Delete page 1', 'Move page 2', 'Delete page 2']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe('QuestionPaperClassTable', () => {
  const classView: QuestionPaperClassView = {
    classId: 'c1',
    className: 'Class 8',
    canManage: true,
    subjects: [
      {
        subjectSlug: 'science',
        subjectName: 'Science',
        modes: [
          { modeSlug: 'theory', modeName: 'Theory', maxMarks: 80, paper: null },
          {
            modeSlug: 'practical',
            modeName: 'Practical',
            maxMarks: 20,
            paper: { pageCount: 2, latestVersionNo: 1, totalMarks: 20, planMaxMarks: 20, warningCount: 0, activeJob: null, lastJobFailure: null },
          },
        ],
      },
    ],
  };

  it('lists a row per subject and mode with its status and opens the clicked one', () => {
    const onOpen = vi.fn();
    render(<QuestionPaperClassTable classView={classView} onOpen={onOpen} />);
    expect(screen.getByText('No paper yet')).toBeTruthy();
    expect(screen.getByText('Version 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Science Practical for Class 8' }));
    expect(onOpen).toHaveBeenCalledWith({ classId: 'c1', subjectSlug: 'science', modeSlug: 'practical' });
  });

  it('offers View, not Open, to someone who cannot manage the class', () => {
    render(<QuestionPaperClassTable classView={{ ...classView, canManage: false }} onOpen={() => {}} />);
    expect(screen.getAllByRole('button', { name: /^Open / })[0]!.textContent).toBe('View');
  });
});

describe('GenerationStatus', () => {
  it('announces a running job without a retry', () => {
    render(<GenerationStatus job={{ status: 'running' }} onRetry={() => {}} />);
    expect(within(screen.getByRole('status')).getByText(/Reading your photos/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the safe failure message and retries on request', () => {
    const onRetry = vi.fn();
    render(<GenerationStatus job={{ status: 'failed', message: 'The photos could not be read.' }} onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('The photos could not be read.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('MarksSummary', () => {
  it('shows the total against the plan and every warning', () => {
    render(
      <MarksSummary
        totalMarks={18}
        planMaxMarks={20}
        warnings={[{ code: 'total_differs_from_plan', message: 'The paper adds up to 18, the plan says 20.' }]}
      />,
    );
    expect(screen.getByText(/Total marks:/).parentElement!.textContent).toContain('18');
    expect(screen.getByText(/of 20 in the plan/)).toBeTruthy();
    expect(screen.getByText('The paper adds up to 18, the plan says 20.')).toBeTruthy();
  });

  it('finds unresolved figure placeholders by warning code', () => {
    expect(hasFigurePlaceholders([{ code: 'figure_placeholder_unresolved', message: '' }])).toBe(true);
    expect(hasFigurePlaceholders([{ code: 'total_differs_from_plan', message: '' }])).toBe(false);
  });
});

describe('VersionList', () => {
  const versions = [
    { versionNo: 2, source: 'agent' as const, createdAt: new Date('2026-11-02T10:00:00Z'), createdByName: 'Asha', totalMarks: 20, warningCount: 1, isLatest: true },
    { versionNo: 1, source: 'ai_job' as const, createdAt: new Date('2026-11-01T10:00:00Z'), createdByName: null, totalMarks: null, warningCount: 0, isLatest: false },
  ];

  it('labels who wrote each version and previews or downloads the chosen one', () => {
    const onPreview = vi.fn();
    const onDownload = vi.fn();
    render(<VersionList versions={versions} selectedVersionNo={2} downloadingVersionNo={null} onPreview={onPreview} onDownload={onDownload} />);
    expect(screen.getByText(/Assistant chat/)).toBeTruthy();
    expect(screen.getByText(/AI from photos/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /Preview/ })[1]!);
    expect(onPreview).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF of version 2' }));
    expect(onDownload).toHaveBeenCalledWith(2);
  });

  it('says so when there is no version', () => {
    render(<VersionList versions={[]} selectedVersionNo={null} downloadingVersionNo={null} onPreview={() => {}} onDownload={() => {}} />);
    expect(screen.getByText('No version has been saved yet.')).toBeTruthy();
  });
});

describe('UploadQueue', () => {
  it('shows progress and keeps a failure until dismissed', () => {
    const onDismiss = vi.fn();
    render(
      <UploadQueue
        onDismiss={onDismiss}
        items={[
          { id: '1', name: 'a.jpg', previewUrl: 'blob:a', status: 'uploading' },
          { id: '2', name: 'b.heic', status: 'error', error: 'A paper holds at most 20 pages.' },
        ]}
      />,
    );
    expect(screen.getByText('Uploading…')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('at most 20 pages');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss b.heic' }));
    expect(onDismiss).toHaveBeenCalledWith('2');
  });

  it('renders nothing when empty', () => {
    const { container } = render(<UploadQueue items={[]} onDismiss={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('ContinueInChatLink', () => {
  it('navigates inside the app on a plain click and leaves modified clicks to the browser', () => {
    const onNavigate = vi.fn();
    // jsdom cannot navigate; this keeps the modified click from logging an error.
    document.addEventListener('click', (event) => event.preventDefault());
    render(<ContinueInChatLink href="/school/s/assistant?seed=question_paper" onNavigate={onNavigate} />);
    const link = screen.getByRole('link', { name: 'Want to update something? Continue in chat' });
    expect(link.getAttribute('href')).toBe('/school/s/assistant?seed=question_paper');
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    fireEvent.click(link, { ctrlKey: true });
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

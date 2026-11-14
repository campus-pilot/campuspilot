// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Camera, FileText } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiBadge } from './ai-badge';
import { GenerationStatus } from './generation-status';
import { PlaceholderNote, RemovedList } from './paper-notices';
import { PaperSourceItem, PaperSourceTray, type PageThumbnailView } from './paper-source-tray';
import { QuestionPaperClassTable, type QuestionPaperClassView } from './question-paper-class-table';
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

describe('PaperSourceTray', () => {
  const tray = { thumbUrl: (id: string) => `/thumb/${id}`, emptyTitle: 'Add the paper', emptyHint: 'Photos of its pages, or a PDF', onAdd: () => {}, onOpen: () => {}, onReorder: () => {}, onDelete: () => {}, onDismissUpload: () => {} };

  it('with nothing in it is the add tile beside what belongs here and the other ways in', () => {
    const onAdd = vi.fn();
    const onCamera = vi.fn();
    render(<PaperSourceTray {...tray} pages={[]} uploads={[]} canAdd onAdd={onAdd} ways={[{ key: 'camera', icon: Camera, label: 'Take a photo', onClick: onCamera }]} />);
    expect(screen.getByText('Photos of its pages, or a PDF')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    // The tile says what it does, and it is the one control assistive technology meets for it.
    const add = screen.getByRole('button', { name: 'Add the paper: Photos of its pages, or a PDF' });
    expect(add.textContent).toBe('Choose files');
    fireEvent.click(add);
    // The words beside it open the picker for a pointer too.
    fireEvent.click(screen.getByText('Add the paper'));
    expect(onAdd).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Take a photo' }));
    expect(onCamera).toHaveBeenCalledOnce();
  });

  it('keeps the other ways in with the add control once there are pages: a tile after it, and a button for a phone', () => {
    const onCamera = vi.fn();
    render(<PaperSourceTray {...tray} pages={pages} uploads={[]} canAdd ways={[{ key: 'camera', icon: Camera, label: 'Take a photo', onClick: onCamera }]} />);
    const cameras = screen.getAllByRole('button', { name: 'Take a photo' });
    expect(cameras).toHaveLength(2);
    for (const camera of cameras) fireEvent.click(camera);
    expect(onCamera).toHaveBeenCalledTimes(2);
  });

  it('never lets a way for one kind of pointer show as a tile on a phone', () => {
    // A phone has a coarse pointer and a narrow screen. Its camera is a button under the pages; the tile is for wide
    // screens only. The tile's classes must not include one that shows it at every width (this once drew two cameras).
    render(<PaperSourceTray {...tray} pages={pages} uploads={[]} canAdd ways={[{ key: 'camera', icon: Camera, label: 'Take a photo', pointer: 'coarse', onClick: () => {} }]} />);
    const [tileButton, phoneButton] = screen.getAllByRole('button', { name: 'Take a photo' });
    const tile = tileButton!.closest('li')!;
    expect(tile.className.split(' ')).toContain('hidden');
    for (const name of tile.className.split(' ').filter((name) => name.includes('pointer:coarse'))) expect(name.startsWith('sm:')).toBe(true);
    expect(phoneButton!.closest('li')!.className).toContain('sm:hidden');
  });

  it('shows each page as a numbered tile, with a thumbnail when one could be made, and ends in the add tile', () => {
    const onAdd = vi.fn();
    render(<PaperSourceTray {...tray} pages={pages} uploads={[]} canAdd onAdd={onAdd} />);
    const tiles = within(screen.getByRole('list', { name: 'Pages of the paper' })).getAllByRole('listitem');
    expect(tiles).toHaveLength(4);
    expect(within(tiles[0]!).getByRole('button', { name: /^Page 1: one\.jpg/ }).querySelector('img')?.getAttribute('src')).toBe('/thumb/a');
    expect(within(tiles[1]!).getByRole('button', { name: /^Page 2: two\.heic/ }).querySelector('img')).toBeNull();
    // The words of the empty tray are gone: the dashed tile after the last page is where the next photo lands.
    expect(screen.queryByText('Add the paper')).toBeNull();
    // The add tile after the last page, and the compact button a phone shows instead: the same words, the same action.
    const adds = screen.getAllByRole('button', { name: 'Add pages' });
    expect(adds).toHaveLength(2);
    expect(tiles[2]!.contains(adds[0]!)).toBe(true);
    for (const add of adds) fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(2);
  });

  it('says how many pages there are and how to reorder them, and opens a pressed page', () => {
    const onOpen = vi.fn();
    render(<PaperSourceTray {...tray} pages={pages} uploads={[]} canAdd onOpen={onOpen} />);
    // One caption for a mouse and one for touch; CSS shows the one that fits.
    expect(screen.getByText(/^2 pages · Click a page to check it, drag to reorder$/)).toBeTruthy();
    expect(screen.getByText(/^2 pages · Tap a page to check or remove it\. Hold and drag to reorder$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Page 2: two\.heic/ }));
    expect(onOpen).toHaveBeenCalledWith('b');
    cleanup();
    // One page has no order to change, and a closed tray does not offer it.
    render(<PaperSourceTray {...tray} pages={pages.slice(0, 1)} uploads={[]} canAdd />);
    expect(screen.getByText('1 page · Click a page to check it')).toBeTruthy();
    cleanup();
    render(<PaperSourceTray {...tray} pages={pages} uploads={[]} canAdd={false} disabled />);
    expect(screen.getByText('2 pages · Click a page to check it')).toBeTruthy();
  });

  it('asks to remove the page of the clicked tile', () => {
    const onDelete = vi.fn();
    render(<PaperSourceTray {...tray} pages={pages} uploads={[]} canAdd onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove page 2' }));
    expect(onDelete).toHaveBeenCalledWith('b');
  });

  it('closes removing while changes are closed and drops the add tile when nothing more fits', () => {
    render(<PaperSourceTray {...tray} pages={pages} uploads={[]} canAdd={false} disabled />);
    for (const name of ['Remove page 1', 'Remove page 2']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.queryByRole('button', { name: 'Add pages' })).toBeNull();
  });

  it('shows photos on their way in the same row, and keeps a failed one until dismissed', () => {
    const onDismissUpload = vi.fn();
    render(
      <PaperSourceTray
        {...tray}
        pages={pages}
        canAdd
        onDismissUpload={onDismissUpload}
        uploads={[
          { id: '1', name: 'c.jpg', previewUrl: 'blob:c', status: 'uploading' },
          { id: '2', name: 'd.heic', status: 'error', error: 'A paper holds at most 20 pages.' },
        ]}
      />,
    );
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByRole('status', { name: 'Adding c.jpg' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'd.heic was not added' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dismiss c.jpg' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss d.heic' }));
    expect(onDismissUpload).toHaveBeenCalledWith('2');
  });
});

describe('PaperSourceItem', () => {
  it('names the source with a line of detail and can be taken out', () => {
    const onRemove = vi.fn();
    render(<PaperSourceItem icon={FileText} title="old-paper.pdf" detail="PDF · 1.2 MB" removeLabel="Remove old-paper.pdf" onRemove={onRemove} />);
    expect(screen.getByText('old-paper.pdf')).toBeTruthy();
    expect(screen.getByText('PDF · 1.2 MB')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove old-paper.pdf' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('carries a quiet action beside the remove button', () => {
    render(<PaperSourceItem icon={FileText} title="Half-Yearly · Theory" detail="2025-26 · Version 2" actions={<button type="button">Preview</button>} removeLabel="Remove" onRemove={() => {}} />);
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();
  });

  it('says why it failed in place of the detail', () => {
    render(<PaperSourceItem icon={FileText} title="old-paper.pdf" detail="PDF · 1.2 MB" status="failed" error="The PDF is larger than 10 MB." removeLabel="Remove" onRemove={() => {}} />);
    expect(screen.getByRole('alert').textContent).toBe('The PDF is larger than 10 MB.');
    expect(screen.queryByText('PDF · 1.2 MB')).toBeNull();
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
            paper: { pageCount: 2, latestVersionNo: 1, warningCount: 0, activeJob: null, lastJobFailure: null },
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

describe('paper notices', () => {
  it('lists what was removed only once opened, and nothing when nothing was', () => {
    const { container, rerender } = render(<RemovedList lines={['A style was removed', 'An attribute was removed']} />);
    expect(screen.queryByText('A style was removed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /2 notices/ }));
    expect(screen.getByText('A style was removed')).toBeTruthy();
    rerender(<RemovedList lines={[]} />);
    expect(container.textContent).toBe('');
  });

  it('says how many figures are still placeholders, and says nothing for none', () => {
    const { container, rerender } = render(<PlaceholderNote count={1} />);
    expect(container.textContent).toMatch(/1 figure is still a placeholder/);
    rerender(<PlaceholderNote count={0} />);
    expect(container.textContent).toBe('');
  });
});

describe('VersionList', () => {
  const versions = [
    { versionNo: 2, source: 'agent' as const, createdAt: new Date('2026-11-02T10:00:00Z'), createdByName: 'Asha', warningCount: 1, isLatest: true },
    { versionNo: 1, source: 'ai_job' as const, createdAt: new Date('2026-11-01T10:00:00Z'), createdByName: null, warningCount: 0, isLatest: false },
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

  it('labels a version copied from an earlier paper', () => {
    const copied = [{ versionNo: 3, source: 'copy' as const, createdAt: new Date('2026-11-03T10:00:00Z'), createdByName: 'Asha', warningCount: 0, isLatest: true }];
    render(<VersionList versions={copied} selectedVersionNo={3} downloadingVersionNo={null} onPreview={() => {}} onDownload={() => {}} />);
    expect(screen.getByText(/Copied from an earlier paper/)).toBeTruthy();
  });

  it('says so when there is no version', () => {
    render(<VersionList versions={[]} selectedVersionNo={null} downloadingVersionNo={null} onPreview={() => {}} onDownload={() => {}} />);
    expect(screen.getByText('No version has been saved yet.')).toBeTruthy();
  });
});

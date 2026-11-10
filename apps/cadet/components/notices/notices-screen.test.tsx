import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { designedNotice, designedNoticePage, featureDisabledError, notices, plainNotice } from '@/test/fixtures';
import { page, renderWithQuery, resetHandlers } from '@/test/orpc-mock';
import { NoticeScreen } from './notice-screen';
import { NoticesScreen } from './notices-screen';

const mocks = vi.hoisted(() => ({ download: vi.fn(), opened: [] as string[] }));

vi.mock('@/lib/orpc', async () => ({
  orpc: (await import('@/test/orpc-mock')).orpcMock,
  client: { getNoticeDownload: mocks.download },
}));

beforeEach(() => {
  mocks.download.mockReset();
  mocks.opened.length = 0;
  resetHandlers({ listNotices: () => page(notices), getNotice: () => plainNotice });
});

describe('NoticesScreen', () => {
  it('lists the notices newest first, each linking to its own screen', async () => {
    renderWithQuery(<NoticesScreen />);
    const links = await screen.findAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/notices/ntc_uniform', '/notices/ntc_sports']);
    expect(links[0]!.textContent).toContain('Winter uniform from Monday');
    expect(links[0]!.textContent).toContain('Published 3 Nov 2026');
    expect(screen.queryByRole('button', { name: 'Show older notices' })).toBeNull();
  });

  it('loads older notices on request', async () => {
    const older = { noticeId: 'ntc_ptm', title: 'Parent-teacher meeting', publishedAt: new Date('2026-09-12T05:30:00Z') };
    resetHandlers({
      listNotices: (input) =>
        (input as { cursor?: string }).cursor === '2'
          ? page([older])
          : { ...page(notices), pagination: { nextCursor: '2', currentPage: 1, totalPages: 2, totalItems: 3, pageSize: 2 } },
    });
    renderWithQuery(<NoticesScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show older notices' }));
    expect((await screen.findByRole('link', { name: /Parent-teacher meeting/ })).getAttribute('href')).toBe('/notices/ntc_ptm');
    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Show older notices' })).toBeNull();
  });

  it('explains an empty list', async () => {
    resetHandlers({ listNotices: () => page([]) });
    renderWithQuery(<NoticesScreen />);
    expect(await screen.findByText('No notices yet')).toBeTruthy();
  });

  it('shows a calm unavailable state, not an error, when the school does not have notices', async () => {
    resetHandlers({ listNotices: () => { throw featureDisabledError('notices'); } });
    renderWithQuery(<NoticesScreen />);
    expect(await screen.findByText('Notices are not available')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('offers a retry when the list really fails', async () => {
    resetHandlers({ listNotices: () => { throw new Error('Network down'); } });
    renderWithQuery(<NoticesScreen />);
    expect(await screen.findByText('Could not load notices')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('NoticeScreen', () => {
  it('shows a notice written as text as text, without a document frame', async () => {
    const { container } = renderWithQuery(<NoticeScreen noticeId="ntc_uniform" />);
    expect(await screen.findByRole('heading', { name: 'Winter uniform from Monday' })).toBeTruthy();
    expect(screen.getByText('Published 3 Nov 2026')).toBeTruthy();
    const paragraphs = [...container.querySelectorAll('article p')].map((p) => p.textContent);
    expect(paragraphs).toEqual([
      'Winter uniform is compulsory from Monday, 9 November.\nBlazers may be collected from the school store.',
      'Class teachers will check uniforms during assembly.',
    ]);
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('never asks for the printed page of a notice written as text', async () => {
    const getNoticeDocument = vi.fn(() => designedNoticePage);
    resetHandlers({ getNotice: () => plainNotice, getNoticeDocument });
    renderWithQuery(<NoticeScreen noticeId="ntc_uniform" />);
    await screen.findByRole('heading', { name: 'Winter uniform from Monday' });
    expect(getNoticeDocument).not.toHaveBeenCalled();
  });

  it('shows a designed notice as its printed page in an empty sandbox, loaded separately from the notice', async () => {
    const getNoticeDocument = vi.fn(() => designedNoticePage);
    resetHandlers({ getNotice: () => designedNotice, getNoticeDocument });
    renderWithQuery(<NoticeScreen noticeId="ntc_sports" />);
    const frame = (await screen.findByTitle('Notice as printed')) as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe(designedNoticePage.html);
    expect(screen.getByRole('heading', { name: 'Annual Sports Day' })).toBeTruthy();
    expect(getNoticeDocument).toHaveBeenCalledWith({ noticeId: 'ntc_sports' });
  });

  it('keeps a designed notice readable as text when its printed page cannot be loaded, and offers to try again', async () => {
    let fail = true;
    resetHandlers({
      getNotice: () => designedNotice,
      getNoticeDocument: () => {
        if (fail) throw new Error('Network down');
        return designedNoticePage;
      },
    });
    const { container } = renderWithQuery(<NoticeScreen noticeId="ntc_sports" />);
    expect((await screen.findByRole('alert')).textContent).toContain('The printed page could not be loaded');
    expect([...container.querySelectorAll('article p')].map((p) => p.textContent)).toEqual(['Annual Sports Day', 'Gates open at 8 AM.']);
    expect(container.querySelector('iframe')).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTitle('Notice as printed')).toBeTruthy();
  });

  it('downloads the PDF through a URL issued on the tap', async () => {
    mocks.download.mockResolvedValue({ url: 'https://files.example.test/notice.pdf?sig=1', expiresIn: 300 });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      mocks.opened.push(this.href);
    });
    renderWithQuery(<NoticeScreen noticeId="ntc_uniform" />);
    fireEvent.click(await screen.findByRole('button', { name: /Download PDF/ }));
    await vi.waitFor(() => expect(mocks.opened).toEqual(['https://files.example.test/notice.pdf?sig=1']));
    expect(mocks.download).toHaveBeenCalledWith({ noticeId: 'ntc_uniform' });
    click.mockRestore();
  });

  it('says so when the PDF cannot be prepared and lets the student try again', async () => {
    mocks.download.mockRejectedValue(new Error('Gotenberg is down'));
    renderWithQuery(<NoticeScreen noticeId="ntc_uniform" />);
    fireEvent.click(await screen.findByRole('button', { name: /Download PDF/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('The PDF could not be prepared. Please try again.');
    expect((screen.getByRole('button', { name: /Download PDF/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says a notice is not found for one that was not sent to the student', async () => {
    resetHandlers({ getNotice: () => { throw Object.assign(new Error('Notice was not found.'), { code: 'NOT_FOUND' }); } });
    renderWithQuery(<NoticeScreen noticeId="someone-else" />);
    expect(await screen.findByText('Notice not found')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Download PDF/ })).toBeNull();
  });

  it('shows the unavailable state when the school does not have notices, and a retry for a real failure', async () => {
    resetHandlers({ getNotice: () => { throw featureDisabledError('notices'); } });
    const off = renderWithQuery(<NoticeScreen noticeId="ntc_uniform" />);
    expect(await screen.findByText('Notices are not available')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    off.unmount();
    resetHandlers({ getNotice: () => { throw new Error('Network down'); } });
    renderWithQuery(<NoticeScreen noticeId="ntc_uniform" />);
    expect(await screen.findByText('Could not load this notice')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AssistantSentAttachments } from './assistant-attachment-strip';
import type { SentAttachment } from './assistant-attachments-model';

afterEach(cleanup);

beforeAll(() => {
  // jsdom has none of the observers embla measures slides with.
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
  globalThis.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver;
  window.matchMedia ??= ((query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList);
});

const image = (id: string): SentAttachment => ({
  id,
  kind: 'image',
  fileName: `${id}.jpg`,
  byteSize: 1,
  previewUrl: `/thumb/${id}`,
  originalUrl: `/original/${id}`,
});

const pdf: SentAttachment = { id: 'notes', kind: 'document', fileName: 'notes.pdf', byteSize: 1, previewUrl: null, originalUrl: null };

describe('AssistantImageViewer', () => {
  // jsdom lays nothing out, so embla cannot move between slides here; which image opens and the arrow keys are checked in the browser.
  it('opens at full size among the message’s images only, with a counter, arrows, download and close', async () => {
    render(<AssistantSentAttachments attachments={[image('a'), pdf, image('b'), image('c')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'View a.jpg' }));

    const dialog = await screen.findByRole('dialog', { name: 'a.jpg' });
    expect(within(dialog).getByText('1 of 3')).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Download a.jpg' }).getAttribute('href')).toBe('/original/a');
    expect(within(dialog).getByAltText('a.jpg').getAttribute('src')).toBe('/original/a');
    // A document never enters the viewer.
    expect(within(dialog).queryByAltText('notes.pdf')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Previous slide' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Next slide' })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows a single image without a counter or arrows, and loads only nearby originals', async () => {
    const { unmount } = render(<AssistantSentAttachments attachments={[image('only')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'View only.jpg' }));
    const single = await screen.findByRole('dialog', { name: 'only.jpg' });
    expect(within(single).queryByText(/of 1/)).toBeNull();
    expect(within(single).queryByRole('button', { name: 'Next slide' })).toBeNull();
    unmount();

    render(<AssistantSentAttachments attachments={['p', 'q', 'r', 's', 't'].map(image)} />);
    fireEvent.click(screen.getByRole('button', { name: 'View p.jpg' }));
    const many = await screen.findByRole('dialog', { name: 'p.jpg' });
    const originals = [...many.querySelectorAll('img')].map((element) => element.getAttribute('src')).filter((src) => src?.startsWith('/original/'));
    expect(originals).toEqual(['/original/p', '/original/q']);
  });
});

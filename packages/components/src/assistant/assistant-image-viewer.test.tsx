// @vitest-environment jsdom
import { TooltipProvider } from '@campuspilot/ui/components/tooltip';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AssistantSentAttachments } from './assistant-attachment-strip';
import type { SentAttachment } from './assistant-attachments-model';
import { AssistantUserMessage } from './assistant-rows';

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

/**
 * A side-by-side layout for embla, which measures slides with `offset*` and
 * reads the last slide's margin: every element 100px square, each slide 100px
 * right of the one before. Restored after the block.
 */
function withSideBySideLayout() {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const computedStyle = window.getComputedStyle;
  beforeAll(() => {
    const define = (name: string, get: (this: HTMLElement) => number) => {
      saved.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get });
    };
    define('offsetWidth', () => 100);
    define('offsetHeight', () => 100);
    define('offsetLeft', function () {
      return this.dataset.slot === 'carousel-item' ? [...this.parentElement!.children].indexOf(this) * 100 : 0;
    });
    // jsdom computes no margins, and embla reads one as a number.
    window.getComputedStyle = ((element: Element) => {
      const style = computedStyle.call(window, element);
      return { getPropertyValue: (name: string) => style.getPropertyValue(name) || '0px' } as CSSStyleDeclaration;
    }) as typeof window.getComputedStyle;
  });
  afterAll(() => {
    for (const [name, descriptor] of saved) if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    window.getComputedStyle = computedStyle;
  });
}

/** The element a browser focuses when the pointer goes down on `element`: itself or its closest focusable ancestor. */
const focusTargetOf = (element: HTMLElement) => element.closest<HTMLElement>('a[href], button, [tabindex]')!;

describe('AssistantImageViewer keyboard and focus', () => {
  withSideBySideLayout();

  it('keeps the arrow keys working after a click on the image', async () => {
    render(<AssistantSentAttachments attachments={[image('a'), image('b'), image('c')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'View b.jpg' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText(/2\s*of\s*3/)).toBeTruthy());

    // A mouse press on the image focuses its closest focusable ancestor; the keys must still reach the carousel.
    focusTargetOf(within(dialog).getByAltText('b.jpg')).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    await waitFor(() => expect(within(dialog).getByText(/1\s*of\s*3/)).toBeTruthy());
  });

  it.each([
    ['Escape', (dialog: HTMLElement) => fireEvent.keyDown(dialog, { key: 'Escape' })],
    ['the close button', (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))],
  ])('gives focus back to the tile that opened it when closed with %s', async (_, close) => {
    render(<AssistantSentAttachments attachments={[image('a'), image('b')]} />);
    const tile = screen.getByRole('button', { name: 'View b.jpg' });
    tile.focus();
    fireEvent.click(tile);
    close(await screen.findByRole('dialog'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(tile);
  });
});

describe('a message still on its way', () => {
  it('shows its images as plain tiles until it is sent, since its bubble is about to be replaced', () => {
    const { rerender } = render(<AssistantUserMessage text="" at={new Date(0)} delivery="sending" attachments={[image('a')]} />, {
      wrapper: TooltipProvider,
    });
    expect(screen.queryByRole('button', { name: 'View a.jpg' })).toBeNull();
    rerender(<AssistantUserMessage text="" at={new Date(0)} delivery="failed" attachments={[image('a')]} />);
    expect(screen.queryByRole('button', { name: 'View a.jpg' })).toBeNull();
    rerender(<AssistantUserMessage text="" at={new Date(0)} delivery="sent" attachments={[image('a')]} />);
    expect(screen.getByRole('button', { name: 'View a.jpg' })).toBeTruthy();
  });
});

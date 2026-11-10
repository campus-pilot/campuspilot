// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmationDialog } from '../confirmation-dialog';
import { DocumentErrors, DocumentPreview } from './document-controls';

afterEach(cleanup);

describe('DocumentPreview', () => {
  it('shows the caller\'s hint while there is nothing to render', () => {
    render(<DocumentPreview label="Preview" placeholder="Write the notice text." />);
    expect(screen.getByText('Write the notice text.')).toBeTruthy();
    expect(screen.queryByTitle('Preview')).toBeNull();
  });

  it('keeps the sandbox empty, also when fitted to the page width', () => {
    for (const fitPageWidth of [false, true]) {
      render(<DocumentPreview label="Preview" html="<p>Hello</p>" fitPageWidth={fitPageWidth} />);
      const frame = screen.getByTitle('Preview') as HTMLIFrameElement;
      expect(frame.getAttribute('sandbox')).toBe('');
      expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
      expect(frame.getAttribute('srcdoc')).toBe('<p>Hello</p>');
      cleanup();
    }
  });

  it('fits the page with a stylesheet rule behind @supports, and falls back to a full-width scrolling frame', () => {
    const { container } = render(<DocumentPreview label="Preview" html="<p>Hello</p>" fitPageWidth />);
    const frame = screen.getByTitle('Preview') as HTMLIFrameElement;
    // Nothing the layout needs is an inline style: an unsupported inline
    // declaration is dropped and left the frame at the default 300x150 px.
    expect(frame.getAttribute('style')).toBeNull();
    // The fallback every browser understands: full width, fixed height.
    expect(frame.className).toContain('w-full');
    expect(frame.className).toContain('h-[640px]');
    expect(frame.className).toContain('document-fitted-frame');
    const css = container.querySelector('style')!.textContent!;
    expect(css).toMatch(/^@supports \(width: 1cqw\) and \(width: calc\(1px \* tan\(atan2\(1px, 1px\)\)\)\) \{/);
    expect(css).toContain('.document-fitted-frame');
    expect(css).toContain('794px');
    // Every scaled declaration is inside the @supports block.
    expect(css.trim().endsWith('}')).toBe(true);
    expect(css.indexOf('transform')).toBeGreaterThan(css.indexOf('@supports'));
  });
});

describe('DocumentErrors', () => {
  it('gives its messages an id to reference, and renders nothing at all without an error', () => {
    const { container, rerender } = render(<DocumentErrors id="title-error" errors={['Enter a title.', 'Enter a title.', { message: 'Too long.' }]} />);
    const box = container.querySelector('#title-error')!;
    expect([...box.querySelectorAll('[role="alert"]')].map((node) => node.textContent)).toEqual(['Enter a title.', 'Too long.']);
    rerender(<DocumentErrors id="title-error" errors={[]} />);
    expect(container.querySelector('#title-error')).toBeNull();
    expect(container.innerHTML).toBe('');
  });
});

describe('ConfirmationDialog confirmDisabled', () => {
  it('blocks only the confirm button, so the dialog can still be cancelled', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<ConfirmationDialog open title="Publish?" description="Final." confirmLabel="Publish" confirmDisabled onOpenChange={onOpenChange} onConfirm={onConfirm} />);
    const confirm = screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

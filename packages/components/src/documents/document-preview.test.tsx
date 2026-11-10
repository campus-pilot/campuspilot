// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmationDialog } from '../confirmation-dialog';
import { DocumentPreview } from './document-controls';

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

  it('lays a fitted page out at A4 width', () => {
    render(<DocumentPreview label="Preview" html="<p>Hello</p>" fitPageWidth />);
    expect((screen.getByTitle('Preview') as HTMLIFrameElement).style.width).toContain('794px');
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

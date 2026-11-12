// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@campuspilot/ui/components/tooltip';
import { createRef } from 'react';

import { AssistantAttachmentStrip, AssistantSentAttachments } from './assistant-attachment-strip';
import {
  AttachmentsMissingError,
  attachmentSendBlock,
  hasMessageContent,
  imagesOnlyLabel,
  markMissingAttachments,
  planAttachmentPicks,
  readyAttachments,
  rejectionSummary,
  type ComposerAttachment,
} from './assistant-attachments-model';
import { AssistantComposer, type AssistantComposerControls } from './assistant-composer';

afterEach(cleanup);

const MB = 1024 * 1024;
const file = (name: string, type = 'image/jpeg', size = 1000) => ({ name, type, size });
const item = (localId: string, status: ComposerAttachment['status'], extra: Partial<ComposerAttachment> = {}): ComposerAttachment => ({
  localId,
  fileName: `${localId}.jpg`,
  previewUrl: null,
  status,
  ref: status === 'ready' ? { id: `asat_${localId}`, fileName: `${localId}.jpg`, contentType: 'image/jpeg', byteSize: 1, width: 1, height: 1, previewable: true } : null,
  error: status === 'failed' ? 'Too big' : null,
  ...extra,
});

describe('planAttachmentPicks', () => {
  it('accepts images in the order picked', () => {
    const plan = planAttachmentPicks([file('a.jpg'), file('b.png', 'image/png'), file('c.heic', ''), file('d.webp', 'image/webp')], 0);
    expect(plan.accepted.map((f) => f.name)).toEqual(['a.jpg', 'b.png', 'c.heic', 'd.webp']);
    expect(plan.rejected).toEqual([]);
  });

  it('refuses other types, empty files and files over 15 MB with a reason each', () => {
    const plan = planAttachmentPicks([file('a.pdf', 'application/pdf'), file('b.jpg', 'image/jpeg', 0), file('c.jpg', 'image/jpeg', 15 * MB + 1), file('d.jpg', 'image/jpeg', 15 * MB)], 0);
    expect(plan.accepted.map((f) => f.name)).toEqual(['d.jpg']);
    expect(plan.rejected.map((r) => r.name)).toEqual(['a.pdf', 'b.jpg', 'c.jpg']);
    expect(plan.rejected[2]!.reason).toMatch(/15 MB/);
  });

  it('holds a message to 20 images, counting those already in the box', () => {
    const many = Array.from({ length: 5 }, (_, index) => file(`${index}.jpg`));
    const plan = planAttachmentPicks(many, 17);
    expect(plan.accepted.map((f) => f.name)).toEqual(['0.jpg', '1.jpg', '2.jpg']);
    expect(plan.rejected).toHaveLength(2);
    expect(plan.rejected[0]!.reason).toBe('A message can carry at most 20 images.');
    expect(planAttachmentPicks(many, 20).accepted).toEqual([]);
  });

  it('summarises refusals in one line', () => {
    expect(rejectionSummary([])).toBeNull();
    expect(rejectionSummary([{ name: 'a.pdf', reason: 'No.' }])).toBe('a.pdf: No.');
    expect(rejectionSummary([{ name: 'a.pdf', reason: 'No.' }, { name: 'b.pdf', reason: 'No.' }])).toBe('2 images were not added. a.pdf: No.');
  });
});

describe('markMissingAttachments', () => {
  it('fails only the named stored images and drops their references', () => {
    const ref = (id: string) => ({ id, fileName: id, contentType: 'image/jpeg', byteSize: 1, width: 1, height: 1, previewable: true });
    const items = [item('a', 'ready', { ref: ref('1') }), item('b', 'ready', { ref: ref('2') })];
    const marked = markMissingAttachments(items, ['2']);
    expect(marked[0]!.status).toBe('ready');
    expect(marked[1]).toMatchObject({ status: 'failed', ref: null });
  });
});

describe('what the box says about its images', () => {
  it('lists only stored images, in order, and blocks sending while one uploads or failed', () => {
    const items = [item('a', 'ready'), item('b', 'uploading'), item('c', 'failed')];
    expect(readyAttachments(items).map((ref) => ref.id)).toEqual(['asat_a']);
    expect(attachmentSendBlock(items)).toMatch(/finish uploading/);
    expect(attachmentSendBlock([item('a', 'ready'), item('c', 'failed')])).toMatch(/Remove the image/);
    expect(attachmentSendBlock([item('a', 'ready')])).toBeNull();
    expect(attachmentSendBlock([])).toBeNull();
  });

  it('has something to send with words or a stored image', () => {
    expect(hasMessageContent('  ', [])).toBe(false);
    expect(hasMessageContent('hi', [])).toBe(true);
    expect(hasMessageContent('', [item('a', 'ready')])).toBe(true);
    expect(hasMessageContent('', [item('a', 'uploading')])).toBe(false);
    expect(imagesOnlyLabel(1)).toBe('1 image');
    expect(imagesOnlyLabel(3)).toBe('3 images');
  });
});

describe('AssistantAttachmentStrip', () => {
  it('shows uploading, ready and failed images and removes the one clicked', () => {
    const onRemove = vi.fn();
    render(
      <TooltipProvider>
        <AssistantAttachmentStrip items={[item('a', 'ready', { previewUrl: '/thumb/a' }), item('b', 'uploading'), item('c', 'failed')]} onRemove={onRemove} />
      </TooltipProvider>,
    );
    const list = screen.getByRole('list', { name: 'Attached images' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect((screen.getByAltText('a.jpg') as HTMLImageElement).getAttribute('src')).toBe('/thumb/a');
    expect(screen.getByRole('status', { name: 'Uploading b.jpg' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Too big' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove b.jpg' }));
    expect(onRemove).toHaveBeenCalledWith('b');
  });

  it('draws nothing for an empty strip and the sent images of a message as tiles', () => {
    const { container } = render(<AssistantAttachmentStrip items={[]} onRemove={() => {}} />);
    expect(container.innerHTML).toBe('');
    cleanup();
    render(<AssistantSentAttachments attachments={[{ id: '1', fileName: 'p.jpg', previewUrl: '/t/1' }, { id: '2', fileName: 'h.heic', previewUrl: null }]} />);
    expect(screen.getByRole('list', { name: '2 attached images' })).toBeTruthy();
    expect((screen.getByAltText('p.jpg') as HTMLImageElement).getAttribute('src')).toBe('/t/1');
    expect(screen.queryByAltText('h.heic')).toBeNull();
  });
});

describe('AssistantComposer images', () => {
  beforeAll(() => {
    // jsdom has no object URLs; the composer shows a local preview while an image uploads.
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });

  const stored = (name: string) => ({
    ref: { id: `asat_${name}`, fileName: name, contentType: 'image/jpeg', byteSize: 5, width: 1, height: 1, previewable: true },
    previewUrl: `/thumb/${name}`,
  });
  const jpeg = (name: string) => new File(['12345'], name, { type: 'image/jpeg' });

  function renderComposer(
    props: Partial<React.ComponentProps<typeof AssistantComposer>> & {
      upload?: (file: File) => Promise<ReturnType<typeof stored>>;
      remove?: (ref: { id: string }) => Promise<void>;
    },
  ) {
    const { upload = async (f: File) => stored(f.name), remove: removeStored = async () => {}, ...rest } = props;
    const onNotice = vi.fn();
    const onSend = vi.fn(async () => {});
    const remove = vi.fn(removeStored);
    render(
      <TooltipProvider>
        <AssistantComposer onSend={onSend} attachments={{ upload, remove, onNotice }} {...rest} />
      </TooltipProvider>,
    );
    return { onSend, onNotice, remove, input: screen.getByLabelText('Attach images', { selector: 'input' }) as HTMLInputElement };
  }

  it('has no paperclip unless attachments are switched on', () => {
    render(
      <TooltipProvider>
        <AssistantComposer onSend={async () => {}} />
      </TooltipProvider>,
    );
    expect(screen.queryByLabelText('Attach images')).toBeNull();
  });

  it('uploads picked images, then sends their stored references in the order picked, with no words', async () => {
    const { onSend, input } = renderComposer({});
    fireEvent.change(input, { target: { files: [jpeg('page1.jpg'), jpeg('page2.jpg')] } });
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole('status', { name: /Uploading/ })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const [text, , refs] = onSend.mock.calls[0] as unknown as [string, unknown, { id: string }[]];
    expect(text).toBe('');
    expect(refs.map((ref) => ref.id)).toEqual(['asat_page1.jpg', 'asat_page2.jpg']);
    // The box is empty again after a successful send.
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Attached images' })).toBeNull());
  });

  it('cannot send while an image uploads, and says why', async () => {
    let finish!: (value: ReturnType<typeof stored>) => void;
    const { onSend, input } = renderComposer({ upload: () => new Promise((resolve) => (finish = resolve)) });
    fireEvent.change(input, { target: { files: [jpeg('slow.jpg')] } });
    await screen.findByRole('status', { name: 'Uploading slow.jpg' });
    const send = screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    finish(stored('slow.jpg'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(false));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps a failed image with its reason and blocks sending until it is removed', async () => {
    const { input } = renderComposer({ upload: async () => Promise.reject(new Error('Not an image')) });
    fireEvent.change(input, { target: { files: [jpeg('bad.jpg')] } });
    await screen.findByRole('img', { name: 'Not an image' });
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove bad.jpg' }));
    expect(screen.queryByRole('list', { name: 'Attached images' })).toBeNull();
  });

  it('reports refused files and adds none past 20', async () => {
    const { input, onNotice } = renderComposer({});
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' }), ...Array.from({ length: 21 }, (_, i) => jpeg(`${i}.jpg`))] } });
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(20));
    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onNotice.mock.calls[0]![0]).toMatch(/2 images were not added/);
  });

  it('puts the images back when the send fails', async () => {
    const onSend = vi.fn(async () => {
      throw new Error('Offline');
    });
    const { input } = renderComposer({ onSend });
    fireEvent.change(input, { target: { files: [jpeg('keep.jpg')] } });
    await waitFor(() => expect(screen.queryByRole('status', { name: /Uploading/ })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Offline');
    expect(screen.getByRole('list', { name: 'Attached images' })).toBeTruthy();
  });

  it('marks the images the server no longer holds as failed, so the same send is not repeated', async () => {
    const onSend = vi.fn(async () => {
      throw new AttachmentsMissingError('An attached image is no longer available.', ['asat_gone.jpg']);
    });
    const { input, remove } = renderComposer({ onSend });
    fireEvent.change(input, { target: { files: [jpeg('gone.jpg'), jpeg('fine.jpg')] } });
    await waitFor(() => expect(screen.queryByRole('status', { name: /Uploading/ })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('An attached image is no longer available.');
    expect(screen.getAllByRole('img', { name: /removed from the server/ })).toHaveLength(1);
    // Sending is blocked until the lost tile is removed, and removing it does not call the server for it.
    expect(attachmentSendBlock([{ ...item('x', 'failed') }])).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove gone.jpg' }));
    expect(remove).not.toHaveBeenCalled();
  });

  it('deletes a stored image from the server when the user removes it, and tells once if that fails', async () => {
    const { input, remove, onNotice } = renderComposer({ remove: async () => Promise.reject(new Error('offline')) });
    fireEvent.change(input, { target: { files: [jpeg('wrong.jpg')] } });
    await waitFor(() => expect(screen.queryByRole('status', { name: /Uploading/ })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Remove wrong.jpg' }));
    expect(screen.queryByRole('list', { name: 'Attached images' })).toBeNull();
    await waitFor(() => expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'asat_wrong.jpg' })));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('could not be removed from the server')));
  });

  it('deletes an upload that finishes after its tile was removed, so it never counts against the cap', async () => {
    let finish!: (value: ReturnType<typeof stored>) => void;
    const { input, remove } = renderComposer({ upload: () => new Promise((resolve) => (finish = resolve)) });
    fireEvent.change(input, { target: { files: [jpeg('late.jpg')] } });
    await screen.findByRole('status', { name: 'Uploading late.jpg' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove late.jpg' }));
    expect(remove).not.toHaveBeenCalled();
    finish(stored('late.jpg'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'asat_late.jpg' })));
  });

  it('does not call the server for an image that failed to upload (nothing is stored)', async () => {
    const { input, remove } = renderComposer({ upload: async () => Promise.reject(new Error('Not an image')) });
    fireEvent.change(input, { target: { files: [jpeg('bad.jpg')] } });
    await screen.findByRole('img', { name: 'Not an image' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove bad.jpg' }));
    expect(remove).not.toHaveBeenCalled();
  });

  it('clears an untouched prefilled sentence through its controls without dropping the attached images', async () => {
    const controls = createRef<AssistantComposerControls>();
    const { input } = renderComposer({ controlsRef: controls, initialText: 'Update this paper: ' });
    fireEvent.change(input, { target: { files: [jpeg('keep.jpg')] } });
    await waitFor(() => expect(screen.queryByRole('status', { name: /Uploading/ })).toBeNull());
    const message = screen.getByLabelText('Message') as HTMLTextAreaElement;
    expect(message.value).toBe('Update this paper: ');
    act(() => controls.current!.clearTextIf('Update this paper: '));
    expect(message.value).toBe('');
    expect(screen.getByRole('button', { name: 'Remove keep.jpg' })).toBeTruthy();
    // A sentence the user edited stays.
    fireEvent.change(message, { target: { value: 'Update this paper: add a question' } });
    act(() => controls.current!.clearTextIf('Update this paper: '));
    expect(message.value).toBe('Update this paper: add a question');
  });
});

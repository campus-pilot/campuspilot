// @vitest-environment jsdom
import {
  ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE,
  type AssistantAttachmentKind,
  type AssistantAttachmentRef,
} from '@campuspilot/assistant-contract/attachments';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@campuspilot/ui/components/tooltip';
import { createRef } from 'react';

import { AssistantAttachmentStrip, AssistantSentAttachments } from './assistant-attachment-strip';
import {
  AttachmentsMissingError,
  attachmentKindOfFile,
  attachmentSendBlock,
  attachmentsOnlyLabel,
  formatAttachmentSize,
  hasMessageContent,
  markMissingAttachments,
  planAttachmentPicks,
  readyAttachments,
  rejectionSummary,
  sentAttachmentsOf,
  type ComposerAttachment,
} from './assistant-attachments-model';
import { AssistantComposer, type AssistantComposerControls } from './assistant-composer';
import { AssistantUserMessageRow } from './assistant-rows';

afterEach(cleanup);

const MB = 1024 * 1024;
const file = (name: string, type = 'image/jpeg', size = 1000) => ({ name, type, size });
const ref = (id: string, kind: AssistantAttachmentKind = 'image', extra: Partial<AssistantAttachmentRef> = {}): AssistantAttachmentRef => ({
  id,
  kind,
  fileName: id,
  contentType: kind === 'document' ? 'application/pdf' : 'image/jpeg',
  byteSize: 1,
  width: kind === 'document' ? null : 1,
  height: kind === 'document' ? null : 1,
  previewable: kind === 'image',
  ...extra,
});
const item = (localId: string, status: ComposerAttachment['status'], extra: Partial<ComposerAttachment> = {}): ComposerAttachment => ({
  localId,
  kind: 'image',
  fileName: `${localId}.jpg`,
  byteSize: 1,
  previewUrl: null,
  status,
  ref: status === 'ready' ? ref(`asat_${localId}`, 'image', { fileName: `${localId}.jpg` }) : null,
  error: status === 'failed' ? 'Too big' : null,
  ...extra,
});
const documentItem = (localId: string, status: ComposerAttachment['status'], byteSize = 820 * 1024): ComposerAttachment =>
  item(localId, status, {
    kind: 'document',
    fileName: `${localId}.pdf`,
    byteSize,
    ref: status === 'ready' ? ref(`asat_${localId}`, 'document', { fileName: `${localId}.pdf`, byteSize }) : null,
  });

describe('attachmentKindOfFile: the composer’s quick check by type', () => {
  it('takes accepted images and PDFs, by the declared type or, when it is generic, the extension', () => {
    expect(attachmentKindOfFile({ name: 'a.jpg', type: 'image/jpeg' })).toBe('image');
    expect(attachmentKindOfFile({ name: 'a.heic', type: '' })).toBe('image');
    expect(attachmentKindOfFile({ name: 'paper.pdf', type: 'application/pdf' })).toBe('document');
    expect(attachmentKindOfFile({ name: 'paper.PDF', type: '' })).toBe('document');
    expect(attachmentKindOfFile({ name: 'paper.pdf', type: 'application/octet-stream' })).toBe('document');
  });

  it('refuses Word and other files, and a .pdf name the browser typed as something else', () => {
    expect(attachmentKindOfFile({ name: 'paper.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBeNull();
    expect(attachmentKindOfFile({ name: 'paper.doc', type: 'application/msword' })).toBeNull();
    expect(attachmentKindOfFile({ name: 'page.pdf', type: 'text/html' })).toBeNull();
    expect(attachmentKindOfFile({ name: 'clip.gif', type: 'image/gif' })).toBeNull();
  });
});

describe('planAttachmentPicks', () => {
  it('accepts images and PDFs in the order picked, each with its kind', () => {
    const plan = planAttachmentPicks(
      [file('a.jpg'), file('b.pdf', 'application/pdf'), file('c.heic', ''), file('d.webp', 'image/webp')],
      0,
    );
    expect(plan.accepted.map(({ file: f, kind }) => [f.name, kind])).toEqual([
      ['a.jpg', 'image'],
      ['b.pdf', 'document'],
      ['c.heic', 'image'],
      ['d.webp', 'image'],
    ]);
    expect(plan.rejected).toEqual([]);
  });

  it('refuses a Word file with the sentence that says to save it as PDF', () => {
    const plan = planAttachmentPicks([file('paper.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')], 0);
    expect(plan.accepted).toEqual([]);
    expect(plan.rejected).toEqual([{ name: 'paper.docx', reason: ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE }]);
    expect(ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE).toMatch(/Save Word and other documents as PDF/);
  });

  it('caps each kind at its own size: images 15 MB, PDFs 10 MB, and refuses empty files', () => {
    const plan = planAttachmentPicks(
      [
        file('empty.jpg', 'image/jpeg', 0),
        file('big.jpg', 'image/jpeg', 15 * MB + 1),
        file('ok.jpg', 'image/jpeg', 15 * MB),
        file('big.pdf', 'application/pdf', 10 * MB + 1),
        file('ok.pdf', 'application/pdf', 10 * MB),
        file('empty.pdf', 'application/pdf', 0),
      ],
      0,
    );
    expect(plan.accepted.map(({ file: f }) => f.name)).toEqual(['ok.jpg', 'ok.pdf']);
    expect(plan.rejected).toEqual([
      { name: 'empty.jpg', reason: 'The file is empty.' },
      { name: 'big.jpg', reason: 'The image is larger than 15 MB.' },
      { name: 'big.pdf', reason: 'The PDF is larger than 10 MB.' },
      { name: 'empty.pdf', reason: 'The file is empty.' },
    ]);
  });

  it('holds a message to 20 attachments of either kind, counting those already in the box', () => {
    const many = [file('0.jpg'), file('1.pdf', 'application/pdf'), file('2.jpg'), file('3.pdf', 'application/pdf'), file('4.jpg')];
    const plan = planAttachmentPicks(many, 17);
    expect(plan.accepted.map(({ file: f }) => f.name)).toEqual(['0.jpg', '1.pdf', '2.jpg']);
    expect(plan.rejected).toHaveLength(2);
    expect(plan.rejected[0]!.reason).toBe('A message can carry at most 20 attachments.');
    expect(planAttachmentPicks(many, 20).accepted).toEqual([]);
  });

  it('summarises refusals in one line', () => {
    expect(rejectionSummary([])).toBeNull();
    expect(rejectionSummary([{ name: 'a.docx', reason: 'No.' }])).toBe('a.docx: No.');
    expect(rejectionSummary([{ name: 'a.docx', reason: 'No.' }, { name: 'b.docx', reason: 'No.' }])).toBe('2 files were not added. a.docx: No.');
  });
});

describe('markMissingAttachments', () => {
  it('fails only the named stored files, images or PDFs, and drops their references', () => {
    const items = [item('a', 'ready', { ref: ref('1') }), documentItem('b', 'ready'), item('c', 'ready', { ref: ref('3') })];
    const marked = markMissingAttachments(items, ['asat_b', '3']);
    expect(marked[0]!.status).toBe('ready');
    expect(marked[1]).toMatchObject({ kind: 'document', status: 'failed', ref: null, error: expect.stringContaining('removed from the server') });
    expect(marked[2]).toMatchObject({ status: 'failed', ref: null });
  });
});

describe('what the box says about its attachments', () => {
  it('lists only stored files, in order, and blocks sending while one uploads or failed', () => {
    const items = [item('a', 'ready'), documentItem('d', 'ready'), item('b', 'uploading'), item('c', 'failed')];
    expect(readyAttachments(items).map((stored) => [stored.id, stored.kind])).toEqual([
      ['asat_a', 'image'],
      ['asat_d', 'document'],
    ]);
    expect(attachmentSendBlock(items)).toMatch(/finish uploading/);
    expect(attachmentSendBlock([item('a', 'ready'), documentItem('c', 'failed')])).toMatch(/Remove the attachment/);
    expect(attachmentSendBlock([item('a', 'ready')])).toBeNull();
    expect(attachmentSendBlock([])).toBeNull();
  });

  it('has something to send with words or a stored file', () => {
    expect(hasMessageContent('  ', [])).toBe(false);
    expect(hasMessageContent('hi', [])).toBe(true);
    expect(hasMessageContent('', [item('a', 'ready')])).toBe(true);
    expect(hasMessageContent('', [documentItem('d', 'ready')])).toBe(true);
    expect(hasMessageContent('', [item('a', 'uploading')])).toBe(false);
  });

  it('labels a message of files only by their kinds', () => {
    expect(attachmentsOnlyLabel(['image'])).toBe('1 image');
    expect(attachmentsOnlyLabel(['image', 'image', 'image'])).toBe('3 images');
    expect(attachmentsOnlyLabel(['document'])).toBe('1 PDF');
    expect(attachmentsOnlyLabel(['document', 'document'])).toBe('2 PDFs');
    expect(attachmentsOnlyLabel(['image', 'document', 'image'])).toBe('3 files');
  });

  it('formats a document tile’s size in KB below a megabyte and MB above', () => {
    expect(formatAttachmentSize(10)).toBe('1 KB');
    expect(formatAttachmentSize(820 * 1024)).toBe('820 KB');
    expect(formatAttachmentSize(3.4 * MB)).toBe('3.4 MB');
    expect(formatAttachmentSize(10 * MB)).toBe('10 MB');
  });
});

describe('sentAttachmentsOf', () => {
  it('asks a thumbnail only for an image the server decoded, never for a document', () => {
    const previewUrlOf = vi.fn((attachment: AssistantAttachmentRef) => `/thumb/${attachment.id}`);
    const sent = sentAttachmentsOf(
      [ref('img'), ref('heic', 'image', { previewable: false }), ref('pdf', 'document', { byteSize: 2048, previewable: true })],
      previewUrlOf,
    );
    expect(sent).toEqual([
      { id: 'img', kind: 'image', fileName: 'img', byteSize: 1, previewUrl: '/thumb/img' },
      { id: 'heic', kind: 'image', fileName: 'heic', byteSize: 1, previewUrl: null },
      { id: 'pdf', kind: 'document', fileName: 'pdf', byteSize: 2048, previewUrl: null },
    ]);
    expect(previewUrlOf.mock.calls.map(([attachment]) => attachment.id)).toEqual(['img']);
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
    const list = screen.getByRole('list', { name: 'Attached files' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect((screen.getByAltText('a.jpg') as HTMLImageElement).getAttribute('src')).toBe('/thumb/a');
    expect(screen.getByRole('status', { name: 'Uploading b.jpg' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Too big' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove b.jpg' }));
    expect(onRemove).toHaveBeenCalledWith('b');
  });

  it('draws a PDF as a document tile with its name and size, never as an image, next to images', () => {
    const { container } = render(
      <TooltipProvider>
        <AssistantAttachmentStrip
          items={[item('a', 'ready', { previewUrl: '/thumb/a' }), documentItem('old-paper', 'ready', 3.4 * MB), documentItem('next', 'uploading')]}
          onRemove={() => {}}
        />
      </TooltipProvider>,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('img', { name: 'old-paper.pdf, PDF, 3.4 MB' })).toBeTruthy();
    expect(screen.getByText('old-paper.pdf')).toBeTruthy();
    expect(screen.getByText('PDF · 3.4 MB')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Uploading next.pdf' })).toBeTruthy();
    // Only the image has an <img>; a document is never loaded into the page.
    expect([...container.querySelectorAll('img')].map((element) => element.getAttribute('src'))).toEqual(['/thumb/a']);
    expect(screen.getByRole('button', { name: 'Remove old-paper.pdf' })).toBeTruthy();
  });

  it('marks a failed PDF with its reason', () => {
    render(
      <TooltipProvider>
        <AssistantAttachmentStrip items={[{ ...documentItem('bad', 'failed'), error: 'A PDF must be 10 MB or smaller.' }]} onRemove={() => {}} />
      </TooltipProvider>,
    );
    expect(screen.getByRole('img', { name: 'A PDF must be 10 MB or smaller.' })).toBeTruthy();
  });

  it('draws nothing for an empty strip and the sent files of a message as tiles by kind', () => {
    const { container } = render(<AssistantAttachmentStrip items={[]} onRemove={() => {}} />);
    expect(container.innerHTML).toBe('');
    cleanup();
    render(
      <AssistantSentAttachments
        attachments={[
          { id: '1', kind: 'image', fileName: 'p.jpg', byteSize: 1, previewUrl: '/t/1' },
          { id: '2', kind: 'image', fileName: 'h.heic', byteSize: 1, previewUrl: null },
          { id: '3', kind: 'document', fileName: 'notes.pdf', byteSize: 820 * 1024, previewUrl: null },
        ]}
      />,
    );
    expect(screen.getByRole('list', { name: '3 attached files' })).toBeTruthy();
    expect((screen.getByAltText('p.jpg') as HTMLImageElement).getAttribute('src')).toBe('/t/1');
    expect(screen.queryByAltText('h.heic')).toBeNull();
    expect(screen.getByRole('img', { name: 'notes.pdf, PDF, 820 KB' })).toBeTruthy();
  });

  it('shows a sent message’s PDF as a document tile and never asks for its thumbnail', () => {
    const previewUrl = vi.fn((attachment: AssistantAttachmentRef) => `/thumb/${attachment.id}`);
    const sentMessage = {
      id: 'item_1',
      kind: 'user_message',
      createdAt: new Date('2026-11-14T08:00:00Z'),
      body: { text: 'Use this old paper', attachments: [ref('asat_pdf', 'document', { fileName: 'old.pdf', byteSize: 2 * MB })] },
    } as never;
    render(
      <TooltipProvider>
        <AssistantUserMessageRow item={sentMessage} attachmentPreviewUrl={previewUrl} />
      </TooltipProvider>,
    );
    expect(screen.getByRole('img', { name: 'old.pdf, PDF, 2.0 MB' })).toBeTruthy();
    expect(previewUrl).not.toHaveBeenCalled();
  });
});

describe('AssistantComposer attachments', () => {
  beforeAll(() => {
    // jsdom has no object URLs; the composer shows a local preview while an image uploads.
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });

  const stored = (name: string, kind: AssistantAttachmentKind = 'image') => ({
    ref: ref(`asat_${name}`, kind, { fileName: name, byteSize: 5 }),
    previewUrl: kind === 'image' ? `/thumb/${name}` : null,
  });
  const jpeg = (name: string) => new File(['12345'], name, { type: 'image/jpeg' });
  const pdf = (name: string) => new File(['%PDF-'], name, { type: 'application/pdf' });

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
    return { onSend, onNotice, remove, input: screen.getByLabelText('Attach files', { selector: 'input' }) as HTMLInputElement };
  }

  it('has no paperclip unless attachments are switched on, and offers images and PDFs when they are', () => {
    render(
      <TooltipProvider>
        <AssistantComposer onSend={async () => {}} />
      </TooltipProvider>,
    );
    expect(screen.queryByLabelText('Attach files')).toBeNull();
    cleanup();
    const { input } = renderComposer({});
    expect(input.accept).toContain('application/pdf');
    expect(input.accept).toContain('image/heic');
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
    expect(refs.map((sent) => sent.id)).toEqual(['asat_page1.jpg', 'asat_page2.jpg']);
    // The box is empty again after a successful send.
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Attached files' })).toBeNull());
  });

  it('uploads a PDF as a document tile with no local preview, and sends it with an image', async () => {
    const createObjectURL = vi.mocked(URL.createObjectURL);
    createObjectURL.mockClear();
    const { onSend, input } = renderComposer({ upload: async (f: File) => stored(f.name, f.type === 'application/pdf' ? 'document' : 'image') });
    fireEvent.change(input, { target: { files: [pdf('old-paper.pdf'), jpeg('photo.jpg')] } });
    await waitFor(() => expect(screen.queryByRole('status', { name: /Uploading/ })).toBeNull());
    expect(screen.getByRole('img', { name: /^old-paper\.pdf, PDF,/ })).toBeTruthy();
    // Only the image got an object URL: a PDF is never rendered in the page.
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const [, , refs] = onSend.mock.calls[0] as unknown as [string, unknown, AssistantAttachmentRef[]];
    expect(refs.map((sent) => [sent.id, sent.kind])).toEqual([
      ['asat_old-paper.pdf', 'document'],
      ['asat_photo.jpg', 'image'],
    ]);
  });

  it('takes the kind the server decided from the bytes over the guess from the file’s type', async () => {
    // Picked as a JPEG, but the server found a PDF: the tile becomes a document and drops its preview.
    const { input } = renderComposer({ upload: async (f: File) => ({ ...stored(f.name, 'document'), previewUrl: '/thumb/should-not-show' }) });
    fireEvent.change(input, { target: { files: [jpeg('scan.jpg')] } });
    await screen.findByRole('img', { name: /^scan\.jpg, PDF,/ });
    expect(screen.queryByAltText('scan.jpg')).toBeNull();
  });

  it('adds a pasted PDF and leaves other pasted files to the browser', async () => {
    const upload = vi.fn(async (f: File) => stored(f.name, 'document'));
    renderComposer({ upload });
    const message = screen.getByLabelText('Message');
    fireEvent.paste(message, { clipboardData: { files: [pdf('pasted.pdf')] } });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    fireEvent.paste(message, { clipboardData: { files: [new File(['x'], 'notes.docx', { type: 'application/msword' })] } });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('adds dropped files and refuses a dropped Word file with the sentence that says to save as PDF', async () => {
    const { onNotice } = renderComposer({});
    const form = screen.getByLabelText('Message').closest('form')!;
    fireEvent.drop(form, { dataTransfer: { files: [new File(['x'], 'paper.docx', { type: 'application/msword' }), jpeg('dropped.jpg')], types: ['Files'] } });
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(onNotice).toHaveBeenCalledWith(`paper.docx: ${ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE}`);
  });

  it('cannot send while a file uploads, and says why', async () => {
    let finish!: (value: ReturnType<typeof stored>) => void;
    const { onSend, input } = renderComposer({ upload: () => new Promise((resolve) => (finish = resolve)) });
    fireEvent.change(input, { target: { files: [pdf('slow.pdf')] } });
    await screen.findByRole('status', { name: 'Uploading slow.pdf' });
    const send = screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    finish(stored('slow.pdf', 'document'));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(false));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps a failed file with its reason and blocks sending until it is removed', async () => {
    const { input } = renderComposer({ upload: async () => Promise.reject(new Error('A PDF must be 10 MB or smaller.')) });
    fireEvent.change(input, { target: { files: [pdf('bad.pdf')] } });
    await screen.findByRole('img', { name: 'A PDF must be 10 MB or smaller.' });
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove bad.pdf' }));
    expect(screen.queryByRole('list', { name: 'Attached files' })).toBeNull();
  });

  it('reports refused files and adds none past 20', async () => {
    const { input, onNotice } = renderComposer({});
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'a.docx', { type: 'application/msword' }), ...Array.from({ length: 21 }, (_, i) => jpeg(`${i}.jpg`))] },
    });
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(20));
    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onNotice.mock.calls[0]![0]).toBe(`2 files were not added. a.docx: ${ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE}`);
  });

  it('puts the files back when the send fails', async () => {
    const onSend = vi.fn(async () => {
      throw new Error('Offline');
    });
    const { input } = renderComposer({ onSend, upload: async (f: File) => stored(f.name, 'document') });
    fireEvent.change(input, { target: { files: [pdf('keep.pdf')] } });
    await waitFor(() => expect(screen.queryByRole('status', { name: /Uploading/ })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Offline');
    expect(screen.getByRole('img', { name: /^keep\.pdf, PDF,/ })).toBeTruthy();
  });

  it('marks the files the server no longer holds as failed, so the same send is not repeated', async () => {
    const onSend = vi.fn(async () => {
      throw new AttachmentsMissingError('An attached file is no longer available.', ['asat_gone.pdf']);
    });
    const { input, remove } = renderComposer({ onSend, upload: async (f: File) => stored(f.name, f.type === 'application/pdf' ? 'document' : 'image') });
    fireEvent.change(input, { target: { files: [pdf('gone.pdf'), jpeg('fine.jpg')] } });
    await waitFor(() => expect(screen.queryByRole('status', { name: /Uploading/ })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('An attached file is no longer available.');
    expect(screen.getAllByRole('img', { name: /removed from the server/ })).toHaveLength(1);
    // Sending is blocked until the lost tile is removed, and removing it does not call the server for it.
    expect(attachmentSendBlock([{ ...item('x', 'failed') }])).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove gone.pdf' }));
    expect(remove).not.toHaveBeenCalled();
  });

  it('deletes a stored file from the server when the user removes it, and tells once if that fails', async () => {
    const { input, remove, onNotice } = renderComposer({ remove: async () => Promise.reject(new Error('offline')) });
    fireEvent.change(input, { target: { files: [jpeg('wrong.jpg')] } });
    await waitFor(() => expect(screen.queryByRole('status', { name: /Uploading/ })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Remove wrong.jpg' }));
    expect(screen.queryByRole('list', { name: 'Attached files' })).toBeNull();
    await waitFor(() => expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'asat_wrong.jpg' })));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('could not be removed from the server')));
  });

  it('deletes an upload that finishes after its tile was removed, so it never counts against the cap', async () => {
    let finish!: (value: ReturnType<typeof stored>) => void;
    const { input, remove } = renderComposer({ upload: () => new Promise((resolve) => (finish = resolve)) });
    fireEvent.change(input, { target: { files: [pdf('late.pdf')] } });
    await screen.findByRole('status', { name: 'Uploading late.pdf' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove late.pdf' }));
    expect(remove).not.toHaveBeenCalled();
    finish(stored('late.pdf', 'document'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'asat_late.pdf' })));
  });

  it('does not call the server for a file that failed to upload (nothing is stored)', async () => {
    const { input, remove } = renderComposer({ upload: async () => Promise.reject(new Error('Not an image')) });
    fireEvent.change(input, { target: { files: [jpeg('bad.jpg')] } });
    await screen.findByRole('img', { name: 'Not an image' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove bad.jpg' }));
    expect(remove).not.toHaveBeenCalled();
  });

  it('clears an untouched prefilled sentence through its controls without dropping the attached files', async () => {
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

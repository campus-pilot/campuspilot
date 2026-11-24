// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TemplateDraftCard } from './template-draft-card';
import { TemplateRevisionList, TemplateRevisionNotice, type TemplateRevisionView } from './template-revisions';

afterEach(cleanup);

const revision = (revisionNo: number, extra: Partial<TemplateRevisionView> = {}): TemplateRevisionView => ({
  revisionId: `art_${revisionNo}`,
  revisionNo,
  name: `Design ${revisionNo}`,
  createdAt: new Date('2026-11-20T10:00:00Z'),
  createdByName: 'Asha',
  marketplaceSlug: null,
  selected: false,
  ...extra,
});

describe('template revisions', () => {
  it('lists every revision with who saved it and marks the one in use and the one shown', () => {
    const onView = vi.fn();
    render(<TemplateRevisionList revisions={[revision(2, { selected: true }), revision(1, { marketplaceSlug: 'bill-default' })]} shownRevisionId="art_1" onView={onView} />);
    expect(screen.getByText('In use')).toBeTruthy();
    expect(screen.getByText(/Imported from the marketplace/)).toBeTruthy();
    expect(screen.getAllByText(/Asha/)).toHaveLength(2);
    expect(screen.getAllByRole('listitem')[1]!.getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getAllByRole('button', { name: /Preview/ })[0]!);
    expect(onView).toHaveBeenCalledWith('art_2');
  });

  it('says an earlier revision is read-only and offers Restore only when it can be restored', () => {
    const onRestore = vi.fn();
    render(<TemplateRevisionNotice revision={revision(3)} onRestore={onRestore} onClose={() => undefined} />);
    expect(screen.getByText(/Revision 3 · read-only/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
    expect(onRestore).toHaveBeenCalled();
    cleanup();
    render(<TemplateRevisionNotice revision={revision(3)} onClose={() => undefined} />);
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull();
  });
});

describe('template draft card', () => {
  it('lists the problems of a draft that cannot be saved', () => {
    render(<TemplateDraftCard ordinal={2} problems={['Template syntax is invalid.']} status="available" onShow={() => undefined} />);
    expect(screen.getByText('Draft 2')).toBeTruthy();
    expect(screen.getByText('Template syntax is invalid.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Show in editor/ })).toBeNull();
  });

  it('offers to show an earlier ready draft in the editor, and says when one is shown', () => {
    const onShow = vi.fn();
    render(<TemplateDraftCard ordinal={1} problems={null} status="available" onShow={onShow} />);
    fireEvent.click(screen.getByRole('button', { name: /Show in editor/ }));
    expect(onShow).toHaveBeenCalled();
    cleanup();
    render(<TemplateDraftCard ordinal={1} problems={null} status="shown" onShow={onShow} />);
    expect(screen.getByText(/Shown in the editor/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Show in editor/ })).toBeNull();
  });

  it('offers Save on a shown or earlier ready draft, as a question paper draft card does', () => {
    const onSave = vi.fn();
    render(<TemplateDraftCard ordinal={1} problems={null} status="shown" onShow={() => undefined} onSave={onSave} />);
    expect((screen.getByRole('button', { name: /Shown in editor/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
    cleanup();
    render(<TemplateDraftCard ordinal={1} problems={null} status="available" onShow={() => undefined} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('offers no Save on a held draft or one from before the last save', () => {
    render(<TemplateDraftCard ordinal={1} problems={null} status="held" onShow={() => undefined} onSave={() => undefined} />);
    expect(screen.getByRole('button', { name: /Replace my edits/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    cleanup();
    render(<TemplateDraftCard ordinal={1} problems={null} status="saved-before" onShow={() => undefined} onSave={() => undefined} />);
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
  });
});

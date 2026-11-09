// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@campuspilot/ui/components/dialog';

import { installPopupDomStubs } from './combobox-test-setup';
import {
  MAX_STUDENT_RECIPIENTS,
  StudentRecipientCombobox,
  type StudentRecipient,
} from './student-recipient-combobox';

const asha = { id: 's1', name: 'Asha Kumari', admissionNo: 'ADM-1' };
const ravi = { id: 's2', name: 'Ravi Singh', admissionNo: 'ADM-2' };

function renderCombobox(
  overrides: { options?: StudentRecipient[]; selected?: StudentRecipient[]; inDialog?: boolean } = {},
) {
  const onChange = vi.fn();
  const onSearch = vi.fn();
  const onDialogOpenChange = vi.fn();
  const combobox = (
    <StudentRecipientCombobox
      options={overrides.options ?? [asha, ravi]}
      selected={overrides.selected ?? []}
      search=""
      onSearch={onSearch}
      onChange={onChange}
      onBlur={() => undefined}
      loading={false}
      onRetry={() => undefined}
      page={1}
      totalPages={1}
      hasNext={false}
      onPage={() => undefined}
      errors={[]}
    />
  );
  render(
    overrides.inDialog ? (
      <Dialog open onOpenChange={onDialogOpenChange}>
        <DialogContent>
          <DialogTitle>Generate documents</DialogTitle>
          <DialogDescription>Pick recipients.</DialogDescription>
          {combobox}
        </DialogContent>
      </Dialog>
    ) : (
      combobox
    ),
  );
  return { onChange, onSearch, onDialogOpenChange };
}

function openPopup() {
  fireEvent.click(screen.getByRole('combobox', { name: 'Find students' }));
  return screen.getByRole('listbox');
}

beforeAll(installPopupDomStubs);
afterEach(cleanup);

describe('StudentRecipientCombobox', () => {
  it('adds a chosen student to the existing selection', () => {
    const { onChange } = renderCombobox({ selected: [asha] });
    fireEvent.click(within(openPopup()).getByText('Ravi Singh'));
    expect(onChange).toHaveBeenCalledWith([asha, ravi]);
  });

  it('forwards typed search text without filtering the remote page locally', () => {
    const { onSearch } = renderCombobox();
    openPopup();
    fireEvent.change(screen.getByPlaceholderText('Search name or admission number…'), {
      target: { value: 'zzz' },
    });
    expect(onSearch).toHaveBeenCalledWith('zzz');
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('removes a student through its chip, even when absent from the current page', () => {
    const { onChange } = renderCombobox({ options: [ravi], selected: [asha, ravi] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Asha Kumari' }));
    expect(onChange).toHaveBeenCalledWith([ravi]);
  });

  it('deselects a chosen student from the list', () => {
    const { onChange } = renderCombobox({ selected: [asha] });
    fireEvent.click(within(openPopup()).getByText('Asha Kumari'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('disables unselected students at the cap but keeps selected ones removable', () => {
    const selected = Array.from({ length: MAX_STUDENT_RECIPIENTS - 1 }, (_, index) => ({
      id: `x${index}`,
      name: `Student ${index}`,
      admissionNo: `X-${index}`,
    }));
    const { onChange } = renderCombobox({ selected: [...selected, asha] });
    const list = openPopup();
    const raviOption = within(list).getByText('Ravi Singh').closest('[role="option"]');
    const ashaOption = within(list).getByText('Asha Kumari').closest('[role="option"]');
    expect(raviOption?.getAttribute('aria-disabled')).toBe('true');
    expect(ashaOption?.getAttribute('aria-disabled')).toBe('false');

    fireEvent.click(within(list).getByText('Ravi Singh'));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(list).getByText('Asha Kumari'));
    expect(onChange).toHaveBeenCalledWith(selected);
  });

  it('stays interactive inside a Radix modal dialog without closing it', async () => {
    const { onChange, onDialogOpenChange } = renderCombobox({ inDialog: true });
    const option = within(openPopup()).getByText('Ravi Singh');
    // Radix registers its outside-pointer listeners on the next tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith([ravi]);
    expect(onDialogOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Generate documents' })).toBeTruthy();
  });
});

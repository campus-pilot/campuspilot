// @vitest-environment jsdom
import { Combobox } from '@campuspilot/ui/components/combobox';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installPopupDomStubs } from './combobox-test-setup';

type Option = { id: string; name: string };
const asha = { id: 'a1', name: 'Asha Kumari' };
const ravi = { id: 'a2', name: 'Ravi Singh' };

function renderSingle(value: Option | null, items: Option[] = [asha, ravi]) {
  const onValueChange = vi.fn();
  render(
    <Combobox
      items={items}
      value={value}
      onValueChange={onValueChange}
      itemKey={(item) => item.id}
      itemLabel={(item) => item.name}
      search=""
      onSearchChange={() => undefined}
      aria-label="Admission"
      placeholder="Select an admission"
      searchLabel="Search admissions"
      emptyMessage="No admissions found."
      showClear
    />,
  );
  return { onValueChange };
}

const trigger = () => screen.getByRole('combobox', { name: 'Admission' });

beforeAll(installPopupDomStubs);
afterEach(cleanup);

describe('single-select Combobox', () => {
  it('selects an option and closes the popup', () => {
    const { onValueChange } = renderSingle(null);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('option', { name: /Ravi Singh/ }));
    expect(onValueChange).toHaveBeenCalledWith(ravi);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('selects the highlighted option with the keyboard', () => {
    const { onValueChange } = renderSingle(null);
    fireEvent.click(trigger());
    const search = screen.getByRole('combobox', { name: 'Search admissions' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onValueChange).toHaveBeenCalledWith(ravi);
  });

  it('shows the selected label when the value is missing from the results', () => {
    renderSingle(asha, [ravi]);
    expect(trigger().textContent).toContain('Asha Kumari');
  });

  it('marks the selected option as checked', () => {
    renderSingle(asha);
    fireEvent.click(trigger());
    expect(screen.getByRole('option', { name: /Asha Kumari/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('option', { name: /Ravi Singh/ }).getAttribute('aria-checked')).toBe('false');
  });

  it('clears the selection', () => {
    const { onValueChange } = renderSingle(asha);
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onValueChange).toHaveBeenCalledWith(null);
  });

  it('shows the empty message when the page has no results', () => {
    renderSingle(null, []);
    fireEvent.click(trigger());
    expect(screen.getByText('No admissions found.')).toBeTruthy();
  });
});

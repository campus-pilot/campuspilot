// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ClassScopePicker } from './class-scope-picker';
import { classScopeSummary, filterClassScopeOptions, pageClassScopeOptions, toggleClassScopeId } from './class-scope-picker-model';
import { installPopupDomStubs } from './documents/combobox-test-setup';

const classes = [
  { id: 'c1', label: 'Class 1' },
  { id: 'c2', label: 'Class 2' },
  { id: 'c10', label: 'Class 10' },
];

beforeAll(installPopupDomStubs);
afterEach(cleanup);

describe('class scope model', () => {
  it('filters by label without regard to case and keeps everything for a blank search', () => {
    expect(filterClassScopeOptions(classes, ' CLASS 1 ').map(({ id }) => id)).toEqual(['c1', 'c10']);
    expect(filterClassScopeOptions(classes, '  ')).toHaveLength(3);
  });

  it('pages the list and clamps a page beyond the end to the last page', () => {
    const many = Array.from({ length: 23 }, (_, index) => index);
    expect(pageClassScopeOptions(many, 1)).toMatchObject({ totalPages: 3, currentPage: 1 });
    expect(pageClassScopeOptions(many, 9)).toEqual({ totalPages: 3, currentPage: 3, visible: [20, 21, 22] });
    expect(pageClassScopeOptions([], 4)).toEqual({ totalPages: 1, currentPage: 1, visible: [] });
  });

  it('toggles one class and keeps display order, dropping classes no longer offered', () => {
    expect(toggleClassScopeId(classes, ['c10'], 'c1')).toEqual(['c1', 'c10']);
    expect(toggleClassScopeId(classes, ['c1', 'c10'], 'c1')).toEqual(['c10']);
    expect(toggleClassScopeId(classes, ['gone', 'c2'], 'c1')).toEqual(['c1', 'c2']);
  });

  it('summarises the selection', () => {
    expect(classScopeSummary(0, 3)).toBe('Choose classes');
    expect(classScopeSummary(2, 3)).toBe('2 of 3 classes');
    expect(classScopeSummary(1, 1)).toBe('1 of 1 class');
  });
});

function renderPicker(overrides: Partial<Parameters<typeof ClassScopePicker>[0]> = {}) {
  const handlers = { onSelectedIdsChange: vi.fn(), onSearchChange: vi.fn(), onPageChange: vi.fn() };
  render(<ClassScopePicker classes={classes} selectedIds={['c2']} search="" page={1} {...handlers} {...overrides} />);
  return handlers;
}

describe('ClassScopePicker', () => {
  it('names its trigger by the label and shows the selection summary', () => {
    renderPicker();
    expect(screen.getByRole('combobox', { name: 'Classes' }).textContent).toContain('1 of 3 classes');
  });

  it('reports the toggled selection in display order', () => {
    const { onSelectedIdsChange } = renderPicker();
    fireEvent.click(screen.getByRole('combobox', { name: 'Classes' }));
    fireEvent.click(screen.getByRole('option', { name: /^Class 1 ?,/ }));
    expect(onSelectedIdsChange).toHaveBeenCalledWith(['c1', 'c2']);
  });

  it('says which classes are chosen in words, since the list highlight is not the choice', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('combobox', { name: 'Classes' }));
    expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true');
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options.filter((text) => text?.endsWith(', selected'))).toHaveLength(1);
    expect(screen.getByRole('option', { name: /, selected$/ }).getAttribute('data-checked')).toBe('true');
    expect(options.filter((text) => text?.endsWith(', not selected'))).toHaveLength(2);
  });

  it('announces its error with the trigger while invalid', () => {
    renderPicker({ invalid: true, errorId: 'classes-error', children: <p id="classes-error">Choose at least one class.</p> });
    const trigger = screen.getByRole('combobox', { name: 'Classes' });
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
    expect(trigger.getAttribute('aria-describedby')).toBe('classes-error');
  });

  it('hands search text to the caller and returns to the first page', () => {
    const { onSearchChange, onPageChange } = renderPicker({ page: 2 });
    fireEvent.click(screen.getByRole('combobox', { name: 'Classes' }));
    fireEvent.change(screen.getByPlaceholderText('Search classes…'), { target: { value: '10' } });
    expect(onSearchChange).toHaveBeenCalledWith('10');
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('is disabled while loading and replaces its help text with the load error', () => {
    renderPicker({ isPending: true, children: <p>Help</p> });
    expect((screen.getByRole('combobox', { name: 'Classes' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Loading classes…')).toBeTruthy();
    cleanup();
    renderPicker({ isError: true, children: <p>Help</p> });
    expect(screen.getByText('Unable to load classes.')).toBeTruthy();
    expect(screen.queryByText('Help')).toBeNull();
  });
});

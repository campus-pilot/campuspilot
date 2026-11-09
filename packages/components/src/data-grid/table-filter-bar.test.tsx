// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TableFilterBar } from './table-filter-bar';

afterEach(() => cleanup());

describe('TableFilterBar', () => {
  it('lets its filter triggers wrap onto further lines instead of widening the page', () => {
    const filters = ['Session', 'Placement', 'Registration', 'WhatsApp'].map((label) => ({
      id: label.toLowerCase(),
      label,
      type: 'single' as const,
      options: [{ label: 'Any', value: 'any' }],
    }));
    render(<TableFilterBar filters={filters} values={{}} onValuesChange={vi.fn()} />);
    const triggers = screen.getByRole('button', { name: 'WhatsApp' }).parentElement!;
    expect(triggers.className).toContain('flex-wrap');
    expect(triggers.className).toContain('min-w-0');
  });
});

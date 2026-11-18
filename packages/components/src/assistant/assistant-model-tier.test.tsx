// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssistantModelSwitch, AssistantProSuggestion } from './assistant-model-tier';

afterEach(cleanup);

describe('AssistantModelSwitch', () => {
  const open = (name: RegExp) => fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' });

  it('shows the model in use and opens a menu that marks it and says what Pro costs', () => {
    const onChange = vi.fn();
    const { rerender } = render(<AssistantModelSwitch tier="standard" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Model: Fast' }).textContent).toContain('Fast');
    open(/^Model: Fast$/);
    const fast = screen.getByRole('menuitemradio', { name: /^Fast/ });
    const pro = screen.getByRole('menuitemradio', { name: /^Pro.*uses more of your school’s assistant budget/ });
    expect(fast.getAttribute('aria-checked')).toBe('true');
    expect(pro.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(pro);
    expect(onChange).toHaveBeenLastCalledWith('pro');

    rerender(<AssistantModelSwitch tier="pro" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Model: Pro' })).toBeTruthy();
  });
});

describe('AssistantProSuggestion', () => {
  it('offers Pro with its cost, or keeping Fast', () => {
    const onUsePro = vi.fn();
    const onDismiss = vi.fn();
    render(<AssistantProSuggestion onUsePro={onUsePro} onDismiss={onDismiss} />);
    expect(screen.getByText('Not happy with the answers? Try Pro.')).toBeTruthy();
    expect(screen.getByText(/uses more of your school’s assistant budget/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use Pro' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep Fast' }));
    expect(onUsePro).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

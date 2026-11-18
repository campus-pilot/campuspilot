// @vitest-environment jsdom
import { TooltipProvider } from '@campuspilot/ui/components/tooltip';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssistantModelSwitch, AssistantProSuggestion } from './assistant-model-tier';

afterEach(cleanup);

describe('AssistantModelSwitch', () => {
  it('shows the picked tier, says what Pro costs, and reports a change but never an empty pick', () => {
    const onChange = vi.fn();
    render(
      <TooltipProvider>
        <AssistantModelSwitch tier="standard" onChange={onChange} />
      </TooltipProvider>,
    );
    const fast = screen.getByRole('radio', { name: /^Fast/ });
    const pro = screen.getByRole('radio', { name: /^Pro: .*uses more of your school’s assistant budget/ });
    expect(fast.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(pro);
    expect(onChange).toHaveBeenLastCalledWith('pro');
    // Clicking the picked option again does not leave the switch without a tier.
    onChange.mockClear();
    fireEvent.click(fast);
    expect(onChange).not.toHaveBeenCalled();
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

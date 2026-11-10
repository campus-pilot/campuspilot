// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NoticeAudienceField, NoticeCadetClassScopeField } from './notice-audience-field';

afterEach(cleanup);

describe('NoticeAudienceField', () => {
  it('offers the three audiences and reports the chosen one', () => {
    const onChange = vi.fn();
    render(<NoticeAudienceField value="staff" choices={['staff', 'cadets', 'staff_and_cadets']} onChange={onChange} />);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    fireEvent.click(screen.getByRole('radio', { name: /Staff and students/ }));
    expect(onChange).toHaveBeenCalledWith('staff_and_cadets');
  });

  it('renders only the choices on offer', () => {
    render(<NoticeAudienceField value="staff" choices={['staff']} onChange={() => undefined} />);
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.queryByText('Students')).toBeNull();
    expect(screen.queryByText('Staff and students')).toBeNull();
  });

  it('shows a stored student audience as the checked choice when students cannot be addressed, and lets the author change it', () => {
    const onChange = vi.fn();
    render(<NoticeAudienceField value="cadets" choices={['staff', 'cadets']} onChange={onChange} />);
    expect((screen.getByRole('radio', { name: /^Students/ }) as HTMLInputElement).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: /^Staff/ }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('radio', { name: /^Staff/ }));
    expect(onChange).toHaveBeenCalledWith('staff');
  });

  it('links its error text to the group while invalid', () => {
    render(
      <NoticeAudienceField value="cadets" choices={['staff', 'cadets']} invalid errorId="audience-error" onChange={() => undefined}>
        <p id="audience-error">Choose Staff.</p>
      </NoticeAudienceField>,
    );
    const group = screen.getByRole('radiogroup');
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(group.getAttribute('aria-describedby')).toBe('audience-error');
  });
});

describe('NoticeCadetClassScopeField', () => {
  it('switches between all classes and selected classes and shows its children', () => {
    const onChange = vi.fn();
    render(<NoticeCadetClassScopeField value="all_classes" onChange={onChange}><p>picker</p></NoticeCadetClassScopeField>);
    fireEvent.click(screen.getByRole('radio', { name: /Selected classes/ }));
    expect(onChange).toHaveBeenCalledWith('selected_classes');
    expect(screen.getByText('picker')).toBeTruthy();
  });
});

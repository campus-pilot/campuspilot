// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NoticeAudienceField, NoticeCadetClassScopeField } from './notice-audience-field';

afterEach(cleanup);

describe('NoticeAudienceField', () => {
  it('offers the three audiences and reports the chosen one', () => {
    const onChange = vi.fn();
    render(<NoticeAudienceField value="staff" cadetsAvailable onChange={onChange} />);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    fireEvent.click(screen.getByRole('radio', { name: /Staff and cadets/ }));
    expect(onChange).toHaveBeenCalledWith('staff_and_cadets');
  });

  it('does not render the student choices without the Cadet Portal', () => {
    render(<NoticeAudienceField value="staff" cadetsAvailable={false} onChange={() => undefined} />);
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.queryByText('Cadets')).toBeNull();
    expect(screen.queryByText('Staff and cadets')).toBeNull();
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

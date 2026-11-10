// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QueryRefreshNote } from './query-refresh-note';

afterEach(cleanup);

describe('QueryRefreshNote', () => {
  it('says nothing while the held data refreshed fine', () => {
    const { container } = render(<QueryRefreshNote error={null} onRetry={() => {}} />);
    expect(container.textContent).toBe('');
  });

  it('says the shown data is the last loaded version and offers Retry after a failed refresh', () => {
    const onRetry = vi.fn();
    render(<QueryRefreshNote error={new Error('offline')} onRetry={onRetry} />);
    expect(screen.getByRole('status').textContent).toContain('Showing the last loaded version');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

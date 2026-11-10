// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IssuedCadetPasswordDialog } from './issued-cadet-password-dialog';

const details = {
  schoolSlug: 'greenwood',
  admissionNo: 'ADM-1',
  password: 'maple-river-42',
};

/** jsdom has no clipboard; each test installs its own. */
function stubClipboard(implementation: (text: string) => Promise<void>) {
  const writeText = vi.fn(implementation);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

/** The dialog keeps its copy state in `useMutation`, so it needs a query client. */
function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <IssuedCadetPasswordDialog details={details} studentName="Asha Kumari" onClose={() => undefined} />,
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
});

describe('IssuedCadetPasswordDialog', () => {
  it('copies all three sign-in details and confirms the copy', async () => {
    const writeText = stubClipboard(async () => undefined);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(
      'School code: greenwood\nAdmission number: ADM-1\nPassword: maple-river-42',
    );
  });

  it('shows the clipboard error when copying fails, and never claims a copy', async () => {
    stubClipboard(async () => {
      throw new Error('denied');
    });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));

    expect(await screen.findByText('Clipboard access is unavailable. Write the details down instead.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy details' })).toBeTruthy();
    // The details stay on screen to be written down.
    expect(screen.getByText('maple-river-42')).toBeTruthy();
  });
});

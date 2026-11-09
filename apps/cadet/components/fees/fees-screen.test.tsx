import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ledgerEntries, profile, summary } from '@/test/fixtures';
import { page, renderWithQuery, resetHandlers } from '@/test/orpc-mock';
import { BillScreen } from './bill-screen';
import { FeesScreen } from './fees-screen';

vi.mock('@/lib/orpc', async () => ({ orpc: (await import('@/test/orpc-mock')).orpcMock }));

const bill = {
  id: 'fbill_1', billNumber: 'BL-2026-1006', issueDate: '2026-10-01', periodKey: 'monthly:2026-10', sessionLabel: '2026–27',
  classLabel: 'Class 7', sectionLabel: 'B', currency: 'INR', totalAmountMinor: '485000', addedMinor: '0', concessionsMinor: '50000',
  netAmountMinor: '435000', reversed: false,
  lines: [{ id: 'a', name: 'Tuition fee', amountMinor: '360000' }, { id: 'b', name: 'Transport', amountMinor: '125000' }],
  adjustments: [{ id: 'adj', kind: 'discount' as const, amountMinor: '50000', recordedAt: new Date('2026-10-05T00:00:00Z'), reversed: false }],
};

beforeEach(() => {
  resetHandlers({
    getProfile: () => profile,
    getFeeSummary: () => summary,
    listFeeLedger: () => page(ledgerEntries),
    getBill: () => bill,
  });
});

describe('FeesScreen', () => {
  it('shows one ledger grouped by month with signed amounts and running balances', async () => {
    renderWithQuery(<FeesScreen />);
    expect(await screen.findByText('Outstanding balance')).toBeTruthy();
    expect(screen.getByText('Class 7 B · 2026–27')).toBeTruthy();
    expect(await screen.findByText('October 2026')).toBeTruthy();
    expect(screen.getByText('− ₹2,350')).toBeTruthy();
    expect(screen.getByText('Bal ₹2,000')).toBeTruthy();
    expect(screen.getByText('+ ₹4,850')).toBeTruthy();
    // Bills open their detail; payments do not link anywhere.
    expect(screen.getByRole('link', { name: /Bill/ }).getAttribute('href')).toBe('/fees/fbill_1');
    expect(screen.getByText(/Bank transfer/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Pay online · coming soon' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /Statement|Download/ })).toBeNull();
  });

  it('writes a negative running balance as credit and names manual charges like management', async () => {
    resetHandlers({
      getProfile: () => profile,
      getFeeSummary: () => summary,
      listFeeLedger: () => page([
        { ...ledgerEntries[0]!, runningBalanceMinor: '-50000' },
        { ...ledgerEntries[2]!, type: 'manual_debit_adjustment' as const },
      ]),
    });
    renderWithQuery(<FeesScreen />);
    expect(await screen.findByText('Bal ₹500 credit')).toBeTruthy();
    expect(screen.queryByText(/Bal -/)).toBeNull();
    expect(screen.getByText('Manual debit adjustment')).toBeTruthy();
  });

  it('explains an empty ledger for a student without fees', async () => {
    resetHandlers({ getProfile: () => profile, getFeeSummary: () => ({ currencies: [] }), listFeeLedger: () => page([]) });
    renderWithQuery(<FeesScreen />);
    expect(await screen.findByText('No fees yet')).toBeTruthy();
  });
});

describe('BillScreen', () => {
  it('shows lines, concessions and the amount after them, without a due date or "left to pay"', async () => {
    const { container } = renderWithQuery(<BillScreen billId="fbill_1" />);
    expect(await screen.findByText('October 2026')).toBeTruthy();
    expect(screen.getByText('Tuition fee')).toBeTruthy();
    expect(screen.getByText('− ₹500')).toBeTruthy();
    expect(screen.getByText('After concessions')).toBeTruthy();
    expect(screen.getByText('₹4,350')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Due|Left to pay|Download/);
  });

  it('says nothing is due on a reversed bill instead of a payable amount', async () => {
    resetHandlers({ getBill: () => ({ ...bill, reversed: true }) });
    renderWithQuery(<BillScreen billId="fbill_1" />);
    expect(await screen.findByText('Reversed – nothing due')).toBeTruthy();
    expect(screen.queryByText('After concessions')).toBeNull();
    expect(screen.getByText('Tuition fee').parentElement!.className).toContain('line-through');
  });

  it('says a bill is not found rather than showing an error for another account', async () => {
    resetHandlers({ getBill: () => { throw Object.assign(new Error('Bill was not found.'), { code: 'NOT_FOUND' }); } });
    renderWithQuery(<BillScreen billId="someone-else" />);
    expect(await screen.findByText('Bill not found')).toBeTruthy();
  });
});

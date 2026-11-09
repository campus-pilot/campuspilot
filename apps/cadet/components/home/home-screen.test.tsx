import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { exams, newStudent, profile, summary } from '@/test/fixtures';
import { page, renderWithQuery, resetHandlers } from '@/test/orpc-mock';
import { Greeting, HomeScreen, LatestResultAlert } from './home-screen';

vi.mock('@/lib/orpc', async () => ({ orpc: (await import('@/test/orpc-mock')).orpcMock }));

beforeEach(() => {
  resetHandlers({
    getProfile: () => profile,
    listExams: () => ({ ...page(exams), record: { recordId: 'stu_b.cls7', classLabel: 'Class 7', sectionLabel: 'B', sessionLabel: '2026–27' } }),
    getFeeSummary: () => summary,
  });
});

describe('HomeScreen', () => {
  it('shows the greeting, then the latest released result, then the fee balance without a due date', async () => {
    const { container } = renderWithQuery(<HomeScreen />);
    expect(await screen.findByText('Hi, Meera')).toBeTruthy();
    expect(screen.getByText('Session 2026–27 · Roll 14 · Adm. GV-1042')).toBeTruthy();
    expect(await screen.findByText('Half-Yearly results are out')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/results/stu_b.cls7.hy');
    expect(await screen.findByText('₹6,850')).toBeTruthy();
    expect(screen.getByText('Fees outstanding')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Due /);
    // Order: greeting, result alert, fees.
    const text = container.textContent ?? '';
    expect(text.indexOf('Hi, Meera')).toBeLessThan(text.indexOf('results are out'));
    expect(text.indexOf('results are out')).toBeLessThan(text.indexOf('Fees outstanding'));
  });

  it('shows no result alert and an empty fee card for a new student', async () => {
    resetHandlers({ getProfile: () => newStudent, getFeeSummary: () => ({ currencies: [] }) });
    renderWithQuery(<HomeScreen />);
    expect(await screen.findByText('No fees have been billed yet.')).toBeTruthy();
    expect(screen.queryByText(/results are out/)).toBeNull();
  });

  it('offers a retry when the profile cannot load', async () => {
    resetHandlers({ getProfile: () => { throw new Error('Network down'); } });
    renderWithQuery(<HomeScreen />);
    expect(await screen.findByText('Network down')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('shows skeletons while results and fees load, and a retry when results fail', async () => {
    resetHandlers({
      getProfile: () => profile,
      listExams: () => { throw new Error('Results are down'); },
      getFeeSummary: () => new Promise(() => {}),
    });
    renderWithQuery(<HomeScreen />);
    expect(await screen.findByLabelText('Loading fees')).toBeTruthy();
    expect(await screen.findByText('Could not load results')).toBeTruthy();
    expect(screen.getByText('Results are down')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('says In credit for a credit balance rather than inferring an advance payment', async () => {
    resetHandlers({
      getProfile: () => profile,
      listExams: () => ({ ...page([]), record: null }),
      getFeeSummary: () => ({ currencies: [{ ...summary.currencies[0]!, balanceMinor: '-50000', dueMinor: '0', creditMinor: '50000' }] }),
    });
    renderWithQuery(<HomeScreen />);
    expect(await screen.findByText('In credit')).toBeTruthy();
    expect(screen.getByText('₹500')).toBeTruthy();
    expect(screen.queryByText(/Advance/)).toBeNull();
  });

  it('skips a released exam without the student\'s marks in the result alert', () => {
    renderWithQuery(
      <LatestResultAlert exams={[{ ...exams[1]!, examId: 'x.y.z', name: 'Not sat', releasedAt: new Date('2026-11-01T00:00:00Z'), percentage: null, grade: null }, exams[1]!]} />,
    );
    expect(screen.getByText('Half-Yearly results are out')).toBeTruthy();
    expect(screen.queryByText(/Not sat/)).toBeNull();
  });

  it('greets by the time of day', () => {
    renderWithQuery(<Greeting profile={profile} hour={19} />);
    expect(screen.getByText('Good evening')).toBeTruthy();
  });
});

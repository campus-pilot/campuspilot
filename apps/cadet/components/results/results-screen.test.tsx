import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { examResult, exams } from '@/test/fixtures';
import { handlers, page, renderWithQuery, resetHandlers } from '@/test/orpc-mock';
import { ResultDetailScreen } from './result-detail-screen';
import { ResultsScreen } from './results-screen';

vi.mock('@/lib/orpc', async () => ({ orpc: (await import('@/test/orpc-mock')).orpcMock }));

const record = { recordId: 'stu_b.cls7', classLabel: 'Class 7', sectionLabel: 'B', sessionLabel: '2026–27' };
const getExamResult = vi.fn(() => examResult);

beforeEach(() => {
  getExamResult.mockClear();
  resetHandlers({ listExams: () => ({ ...page(exams), record }), getExamResult });
});

describe('ResultsScreen', () => {
  it('shows scores only for released exams and an explicit awaiting state', async () => {
    renderWithQuery(<ResultsScreen />);
    expect(await screen.findByText('Half-Yearly')).toBeTruthy();
    expect(screen.getByText('82.4% · A')).toBeTruthy();
    expect(screen.getByText('Awaiting release')).toBeTruthy();
    expect(screen.getByText('Upcoming')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Unit Test 2/ }).getAttribute('href')).toBe('/results/stu_b.cls7.ut2');
    expect(screen.queryByRole('link', { name: /Annual/ })).toBeNull();
  });

  it('explains when there are no examinations yet', async () => {
    resetHandlers({ listExams: () => ({ ...page([]), record: null }) });
    renderWithQuery(<ResultsScreen />);
    expect(await screen.findByText('No examinations yet')).toBeTruthy();
  });
});

describe('ResultDetailScreen', () => {
  it('shows subjects with the change since the previous exam, the remark and activities', async () => {
    renderWithQuery(<ResultDetailScreen examId="stu_b.cls7.hy" />);
    expect(await screen.findByText('Mathematics')).toBeTruthy();
    expect(screen.getByText('vs Unit Test 1')).toBeTruthy();
    expect(screen.getByLabelText('+11 points since the previous exam')).toBeTruthy();
    expect(screen.getByLabelText('−8 points since the previous exam')).toBeTruthy();
    expect(screen.getByText('“Excellent progress in Mathematics.”')).toBeTruthy();
    expect(screen.getByText('Art education')).toBeTruthy();
    expect(screen.getByText('96/102 days')).toBeTruthy();
    expect(screen.queryByText(/Class average/)).toBeNull();
    expect(handlers.listExams).toBeDefined();
  });

  it('says results are not released yet without asking for marks', async () => {
    renderWithQuery(<ResultDetailScreen examId="stu_b.cls7.ut2" />);
    expect(await screen.findByText('Results not released yet')).toBeTruthy();
    expect(getExamResult).not.toHaveBeenCalled();
  });

  it('treats an unknown or foreign exam as unavailable', async () => {
    resetHandlers({ listExams: () => { throw Object.assign(new Error('Class was not found.'), { code: 'NOT_FOUND' }); } });
    renderWithQuery(<ResultDetailScreen examId="stu_x.cls9.hy" />);
    expect(await screen.findByText('Result not available')).toBeTruthy();
  });
});

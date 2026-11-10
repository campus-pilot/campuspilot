import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { examResult, exams } from '@/test/fixtures';
import { handlers, page, renderWithQuery, resetHandlers } from '@/test/orpc-mock';
import { ResultDetailScreen } from './result-detail-screen';
import { ResultsScreen } from './results-screen';

vi.mock('@/lib/orpc', async () => ({ orpc: (await import('@/test/orpc-mock')).orpcMock }));

const record = { recordId: 'stu_b.cls7', classLabel: 'Class 7', sectionLabel: 'B', sessionLabel: '2026–27' };
const getExamResult = vi.fn(() => examResult);

const getExam = (input: unknown) => {
  const exam = exams.find((item) => item.examId === (input as { examId: string }).examId);
  if (!exam) throw Object.assign(new Error('Examination was not found.'), { code: 'NOT_FOUND' });
  return exam;
};

beforeEach(() => {
  getExamResult.mockClear();
  resetHandlers({ listExams: () => ({ ...page(exams), record }), getExamResult, getExam });
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

  it('loads more examinations when the class has another page', async () => {
    const listExams = vi.fn((input: unknown) =>
      (input as { cursor?: string }).cursor
        ? { ...page([exams[3]!]), record }
        : { items: exams.slice(0, 3), pagination: { nextCursor: '2', currentPage: 1, totalPages: 2, totalItems: 4, pageSize: 3 }, record },
    );
    resetHandlers({ listExams });
    renderWithQuery(<ResultsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Annual')).toBeTruthy();
    expect(listExams).toHaveBeenLastCalledWith({ cursor: '2' });
  });

  it('shows an earlier class from /results/class/{recordId} with a way back to the current class', async () => {
    const listExams = vi.fn(() => ({ ...page([exams[0]!]), record: { recordId: 'stu_a.cls6', classLabel: 'Class 6', sectionLabel: 'A', sessionLabel: '2025–26' } }));
    resetHandlers({ listExams });
    renderWithQuery(<ResultsScreen recordId="stu_a.cls6" />);
    expect(await screen.findByText('Results for Class 6')).toBeTruthy();
    expect(listExams).toHaveBeenCalledWith({ filters: { recordId: 'stu_a.cls6' } });
    expect(screen.getByRole('link', { name: 'Back to current class' }).getAttribute('href')).toBe('/results');
    expect(screen.queryByText(/Earlier classes are in Growth/)).toBeNull();
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
    expect(screen.getByRole('link', { name: 'See growth across exams' }).getAttribute('href')).toBe(`/growth/class/${examResult.recordId}`);
    expect(screen.queryByText(/Class average/)).toBeNull();
    expect(handlers.getExam).toBeDefined();
  });

  it('says results are not released yet without asking for marks', async () => {
    renderWithQuery(<ResultDetailScreen examId="stu_b.cls7.ut2" />);
    expect(await screen.findByText('Results not released yet')).toBeTruthy();
    expect(getExamResult).not.toHaveBeenCalled();
  });

  it('treats an unknown or foreign exam as unavailable', async () => {
    renderWithQuery(<ResultDetailScreen examId="stu_x.cls9.hy" />);
    expect(await screen.findByText('Result not available')).toBeTruthy();
  });
});

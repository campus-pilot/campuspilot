import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { growth } from '@/test/fixtures';
import { page, renderWithQuery, resetHandlers } from '@/test/orpc-mock';
import { GrowthView, shortLabel, subjectChanges } from './growth-screen';

vi.mock('@/lib/orpc', async () => ({ orpc: (await import('@/test/orpc-mock')).orpcMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

beforeEach(() => {
  resetHandlers({
    listRemarks: () => page([{ examId: 'stu_b.cls7.hy', examName: 'Half-Yearly', recordId: 'stu_b.cls7', text: 'Keep it up.', authorName: 'Ms. Iyer', updatedAt: new Date('2026-10-03T00:00:00Z') }]),
  });
});

describe('GrowthView', () => {
  it('shows the class, its subject changes, class by class and remarks', async () => {
    renderWithQuery(<GrowthView growth={growth} studentName="Meera Singh" />);
    expect(screen.getByText('Class 7 B · 2026–27')).toBeTruthy();
    expect(screen.getByText('Mathematics +11')).toBeTruthy();
    expect(screen.getByText('Social Science −8')).toBeTruthy();
    expect(screen.getByText('Class by class')).toBeTruthy();
    expect(screen.getByText('+12.5 vs class')).toBeTruthy();
    expect(screen.getByText('No class average')).toBeTruthy();
    expect(await screen.findByText('“Keep it up.”')).toBeTruthy();
  });

  it('only compares subjects of the selected class', () => {
    const changes = subjectChanges(growth.selected!);
    expect(changes.every(({ subject }) => subject.subjectId.startsWith('stu_b.cls7.'))).toBe(true);
  });

  it('says when the school does not share class averages', () => {
    const hidden = {
      ...growth,
      classAveragesShared: false,
      selected: { ...growth.selected!, exams: growth.selected!.exams.map((exam) => ({ ...exam, classAveragePercentage: null, subjectAverages: null })) },
    };
    renderWithQuery(<GrowthView growth={hidden} studentName="Meera Singh" />);
    expect(screen.getByText(/doesn.t share class averages/)).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'vs class average' })).toBeNull();
  });

  it('explains an empty growth view for a student without released results', () => {
    renderWithQuery(<GrowthView growth={{ classes: [], selected: null, classAveragesShared: false }} studentName="Meera" />);
    expect(screen.getByText('Nothing to compare yet')).toBeTruthy();
  });

  it('shortens long exam names for chart axes', () => {
    expect(shortLabel('Half-Yearly')).toBe('HY');
    expect(shortLabel('Unit Test 1')).toBe('UT1');
    expect(shortLabel('Annual')).toBe('Annual');
  });
});

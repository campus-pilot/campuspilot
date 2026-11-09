// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { StudentExamRemarkPreview } from './student-exam-remark-preview';

afterEach(cleanup);

const remark = { text: 'Steady progress.', authorName: 'Ms. Iyer', updatedAt: '2026-10-03T00:00:00Z' };

describe('StudentExamRemarkPreview', () => {
  it('locks the remark and hides edit actions while released to the Cadet Portal', () => {
    render(<StudentExamRemarkPreview remark={remark} released actions={<button type="button">Edit remark</button>} />);
    expect(screen.getByText('Steady progress.')).toBeTruthy();
    expect(screen.getByText('Locked while the results are released to the Cadet Portal.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit remark' })).toBeNull();
  });

  it('offers the actions when not released and explains a missing remark', () => {
    render(<StudentExamRemarkPreview remark={null} released={false} actions={<button type="button">Write remark</button>} />);
    expect(screen.getByText('No remark written yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Write remark' })).toBeTruthy();
    expect(screen.queryByText(/Locked/)).toBeNull();
  });
});

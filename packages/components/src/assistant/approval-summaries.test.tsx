// @vitest-environment jsdom
import type { AssistantToolCallItemDto } from '@campuspilot/assistant-contract/dto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { approvalDraftId, approvalPaperScope, approvalSummaryOf } from './approval-summaries';
import { AssistantApprovalRequest } from './assistant-approval-card';

afterEach(cleanup);

const TOOL = 'school.saveQuestionPaperVersion';
const input = {
  schoolId: 'sch',
  sessionId: 'ses1',
  examSlug: 'annual',
  classId: 'cls1',
  subjectSlug: 'maths',
  modeSlug: 'oral',
  expectedVersionNo: 3,
  draftId: 'abc123abc123',
};
const facts = { paperLabel: 'Mathematics (Oral), Class 5, Annual Examination', draftOrdinal: 2 };

describe('approval summaries', () => {
  it('writes the save sentence from names, the draft ordinal and the next version number', () => {
    expect(approvalSummaryOf(TOOL, input, facts)?.sentence).toBe(
      'Save Draft 2 as version 4 of Mathematics (Oral), Class 5, Annual Examination.',
    );
    expect(approvalSummaryOf(TOOL, { ...input, expectedVersionNo: 0 }, facts)?.sentence).toContain('as version 1 of');
  });

  it('degrades to plain words while a name or the draft is unknown', () => {
    expect(approvalSummaryOf(TOOL, input, { paperLabel: null, draftOrdinal: null })?.sentence).toBe(
      'Save the draft as version 4 of this paper.',
    );
  });

  it('describes pasted html by its size and notes it instead of its text', () => {
    const summary = approvalSummaryOf(TOOL, { ...input, draftId: undefined, html: '<p>x</p>'.repeat(1000) }, facts)!;
    expect(summary.sentence).toContain('the paper text (8,000 characters)');
    expect(summary.notes.html).toBe('Paper text, 8,000 characters (not shown)');
  });

  it('has no summary for other tools, and finds the paper and draft only for tools that have one', () => {
    expect(approvalSummaryOf('school.updateAdmission', input, facts)).toBeNull();
    expect(approvalPaperScope('school.updateAdmission', input)).toBeNull();
    expect(approvalPaperScope(TOOL, input)).toEqual({
      sessionId: 'ses1',
      examSlug: 'annual',
      classId: 'cls1',
      subjectSlug: 'maths',
      modeSlug: 'oral',
    });
    expect(approvalPaperScope(TOOL, { schoolId: 's' })).toBeNull();
    expect(approvalDraftId(TOOL, input)).toBe('abc123abc123');
    expect(approvalDraftId('school.updateAdmission', input)).toBeNull();
  });
});

describe('AssistantApprovalRequest with a summary', () => {
  const call = (body: Record<string, unknown>) =>
    ({
      id: 'i',
      kind: 'tool_call',
      status: 'awaiting_approval',
      body: { toolName: TOOL, title: 'Save a question paper version', input: body, destructive: false },
    }) as unknown as AssistantToolCallItemDto;

  it('shows the sentence, keeps ids and the version counter behind Details and never dumps the paper text', () => {
    const withHtml = { ...input, draftId: undefined, html: '<p>SECRET-PAPER-TEXT</p>' };
    render(
      <AssistantApprovalRequest call={call(withHtml)} waiting={1} summary={approvalSummaryOf(TOOL, withHtml, facts)} onDecide={() => {}} />,
    );
    expect(screen.getByText(/Save the paper text \(24 characters\) as version 4 of Mathematics/)).toBeTruthy();
    expect(screen.queryByText('Class Id')).toBeNull();
    expect(screen.queryByText(/SECRET-PAPER-TEXT/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Details/ }));
    expect(screen.getByText('Class Id')).toBeTruthy();
    expect(screen.getByText('Paper text, 24 characters (not shown)')).toBeTruthy();
    expect(screen.queryByText(/SECRET-PAPER-TEXT/)).toBeNull();
  });

  it('keeps the generic labelled list when there is no summary', () => {
    render(<AssistantApprovalRequest call={call(input)} waiting={1} onDecide={() => {}} />);
    expect(screen.getByText('Class Id')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Details/ })).toBeNull();
  });
});

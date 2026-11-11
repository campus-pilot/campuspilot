// @vitest-environment jsdom
import type { AssistantToolCallItemDto } from '@campuspilot/assistant-contract/dto';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AssistantApprovalRequest } from './assistant-approval-card';

afterEach(cleanup);

/** A change waiting for approval; only the fields the request reads matter here. */
const call = (toolName: string, input: unknown) =>
  ({
    id: 'item_1',
    kind: 'tool_call',
    status: 'awaiting_approval',
    body: { toolUseId: 'tu_1', toolName, title: 'Change', access: 'write', destructive: false, module: 'billing', input, approvalId: 'apr_1' },
  }) as unknown as AssistantToolCallItemDto;

/** The value shown next to a label in the request's list of changes. */
const valueOf = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;

describe('AssistantApprovalRequest money', () => {
  it('shows a payment amount as money in the currency the input names', () => {
    render(
      <AssistantApprovalRequest
        call={call('school.recordPayment', { schoolId: 's', amountMinor: '125000', currency: 'INR', method: 'cash' })}
        waiting={1}
        onDecide={() => {}}
      />,
    );
    expect(valueOf('Amount')).toBe('₹1,250.00');
    expect(screen.queryByText('Amount Minor')).toBeNull();
  });

  it('shows manual bill lines in the currency the app passes, and as minor units without one', () => {
    const input = { schoolId: 's', sessionId: 'ses_1', lines: [{ title: 'Tuition', amountMinor: '125000' }] };
    const { rerender } = render(
      <AssistantApprovalRequest call={call('school.createManualBill', input)} waiting={1} currency="INR" onDecide={() => {}} />,
    );
    expect(valueOf('Amount')).toBe('₹1,250.00');
    rerender(<AssistantApprovalRequest call={call('school.createManualBill', input)} waiting={1} onDecide={() => {}} />);
    expect(valueOf('Amount')).toBe('125000 (minor units)');
  });
});

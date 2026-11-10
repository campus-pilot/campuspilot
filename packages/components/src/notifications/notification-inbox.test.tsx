// @vitest-environment jsdom
import { NOTIFICATION_TYPES, type NotificationType } from '@campuspilot/db/notifications/catalogue';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { notificationBellLabel, unreadBadgeText, type NotificationLinkProps } from './notification-bell';
import { NotificationInbox, type NotificationInboxProps } from './notification-inbox';
import { notificationRenderers, type NotificationListItem } from './notification-renderers';

afterEach(() => cleanup());

const bill: NotificationListItem = {
  id: 'ntf_bill',
  type: 'bill.issued',
  data: { billId: 'b', sessionId: 's', admissionId: 'a', billNumber: 'BILL/7', totalAmountMinor: '250000', currency: 'INR', issueDate: '2026-10-01', studentName: 'Asha' },
  createdAt: '2026-11-09T08:00:00.000Z',
  readAt: null,
};
const run: NotificationListItem = {
  id: 'ntf_run',
  type: 'billing.run_posted',
  data: { billRunId: 'r', sessionId: 's', periodKey: '2026-10', billCount: 1 },
  createdAt: '2026-11-08T08:00:00.000Z',
  readAt: '2026-11-08T09:00:00.000Z',
};

function link({ href, className, onClick, children }: NotificationLinkProps) {
  return <a href={href} className={className} onClick={(event) => { event.preventDefault(); onClick?.(); }}>{children}</a>;
}

function renderInbox(overrides: Partial<NotificationInboxProps> = {}) {
  const props: NotificationInboxProps = {
    items: [bill, run],
    status: 'success',
    filter: 'all',
    onFilterChange: vi.fn(),
    hasMore: false,
    isLoadingMore: false,
    onLoadMore: vi.fn(),
    onMarkRead: vi.fn(),
    onMarkAllRead: vi.fn(),
    onDismiss: vi.fn(),
    onRetry: vi.fn(),
    routeFor: (item) => (item.type === 'billing.run_posted' ? '/runs/r' : null),
    renderLink: link,
    ...overrides,
  };
  render(<NotificationInbox {...props} />);
  return props;
}

describe('notification registry', () => {
  it('renders every catalogue type', () => {
    expectTypeOf<keyof typeof notificationRenderers>().toEqualTypeOf<NotificationType>();
    expect(Object.keys(notificationRenderers).sort()).toEqual([...NOTIFICATION_TYPES].sort());
  });
});

describe('NotificationInbox', () => {
  it('renders rows from facts and offers mark read for unread, dismiss for read', () => {
    const props = renderInbox();
    expect(screen.getByText('New bill BILL/7')).toBeTruthy();
    expect(screen.getByText('₹2,500.00 issued on 2026-10-01.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
    expect(props.onMarkRead).toHaveBeenCalledWith('ntf_bill');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(props.onDismiss).toHaveBeenCalledWith('ntf_run');
    expect(screen.getByRole('link').getAttribute('href')).toBe('/runs/r');
  });

  it('marks an unread row read when its link is opened', () => {
    const props = renderInbox({ items: [{ ...run, readAt: null }] });
    fireEvent.click(screen.getByRole('link'));
    expect(props.onMarkRead).toHaveBeenCalledWith('ntf_run');
  });

  it('shows empty, error and paging states', () => {
    const empty = renderInbox({ items: [], filter: 'unread' });
    expect(screen.getByText('No unread notifications')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(empty.onFilterChange).toHaveBeenCalledWith('all');
    cleanup();
    const failed = renderInbox({ status: 'error' });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(failed.onRetry).toHaveBeenCalled();
    cleanup();
    const paged = renderInbox({ hasMore: true });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(paged.onLoadMore).toHaveBeenCalled();
  });

  it('labels the bell with the unread count', () => {
    expect(unreadBadgeText(0)).toBeNull();
    expect(unreadBadgeText(120)).toBe('99+');
    expect(notificationBellLabel(3)).toBe('Notifications, 3 unread');
  });
});

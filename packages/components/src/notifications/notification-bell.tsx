import type { ReactNode } from 'react';
import { buttonVariants } from '@campuspilot/ui/components/button';
import { Bell } from 'lucide-react';

/** Props a link renderer receives; apps pass their router's link component. */
export type NotificationLinkProps = {
  href: string;
  className?: string;
  ariaLabel?: string;
  /** Runs before the app navigates (for example, marking the row read). */
  onClick?: () => void;
  children: ReactNode;
};

/** Badge text for an unread count: nothing at zero, `99+` above 99. */
export function unreadBadgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

/** Accessible name of the bell, including the unread count. */
export function notificationBellLabel(count: number): string {
  if (count <= 0) return 'Notifications';
  return `Notifications, ${count} unread`;
}

/**
 * The notification bell: an icon link to the inbox page with an unread
 * badge. Presentational; the app supplies the count (polled) and its link
 * component.
 */
export function NotificationBell({
  unreadCount,
  href,
  renderLink,
}: {
  unreadCount: number;
  href: string;
  renderLink: (props: NotificationLinkProps) => ReactNode;
}) {
  const badge = unreadBadgeText(unreadCount);
  return renderLink({
    href,
    ariaLabel: notificationBellLabel(unreadCount),
    className: `${buttonVariants({ variant: 'ghost', size: 'icon' })} relative`,
    children: (
      <>
        <Bell aria-hidden />
        {badge ? (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] leading-none font-medium text-primary-foreground">
            {badge}
          </span>
        ) : null}
      </>
    ),
  });
}

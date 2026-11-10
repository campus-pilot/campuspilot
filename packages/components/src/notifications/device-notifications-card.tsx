import { Button } from '@campuspilot/ui/components/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@campuspilot/ui/components/item';
import { BellOff, BellRing } from 'lucide-react';

/**
 * Notification state of this device for the signed-in student.
 * - `loading`: still reading the browser and server state;
 * - `unsupported`: this browser cannot receive web push;
 * - `needs_install`: iPhone/iPad: push works only in the installed app;
 * - `denied`: notifications are blocked in the browser's site settings;
 * - `off` / `on`: the student can turn them on or off here.
 */
export type DeviceNotificationStatus = 'loading' | 'unsupported' | 'needs_install' | 'denied' | 'off' | 'on';

const DESCRIPTIONS: Record<DeviceNotificationStatus, string> = {
  loading: 'Checking this device…',
  unsupported: 'This browser cannot show notifications. Try Chrome, Edge, Firefox or Safari.',
  needs_install: 'Add the Cadet Portal to your Home Screen (Share → “Add to Home Screen”), open it from there, then turn notifications on.',
  denied: 'Notifications are blocked for this site. Allow them in your browser’s site settings, then reload.',
  off: 'Get bills, receipts and results on this device as they arrive.',
  on: 'New notifications appear on this device.',
};

/**
 * "Turn on notifications" for this device. Presentational: the app reads
 * the device state and performs the (gesture-bound) permission request and
 * subscription in `onTurnOn`.
 */
export function DeviceNotificationsCard({
  status,
  pending,
  errorMessage,
  onTurnOn,
  onTurnOff,
}: {
  status: DeviceNotificationStatus;
  pending: boolean;
  errorMessage?: string | null;
  onTurnOn: () => void;
  onTurnOff: () => void;
}) {
  const on = status === 'on';
  return (
    <Item variant="outline">
      <ItemMedia variant="icon">{on ? <BellRing /> : <BellOff />}</ItemMedia>
      <ItemContent>
        <ItemTitle>Notifications on this device</ItemTitle>
        <ItemDescription>{errorMessage ?? DESCRIPTIONS[status]}</ItemDescription>
      </ItemContent>
      <DeviceNotificationsAction status={status} pending={pending} onTurnOn={onTurnOn} onTurnOff={onTurnOff} />
    </Item>
  );
}

function DeviceNotificationsAction({
  status,
  pending,
  onTurnOn,
  onTurnOff,
}: {
  status: DeviceNotificationStatus;
  pending: boolean;
  onTurnOn: () => void;
  onTurnOff: () => void;
}) {
  if (status === 'off') {
    return (
      <ItemActions>
        <Button type="button" disabled={pending} onClick={onTurnOn}>
          {pending ? 'Turning on…' : 'Turn on notifications'}
        </Button>
      </ItemActions>
    );
  }
  if (status === 'on') {
    return (
      <ItemActions>
        <Button type="button" variant="outline" disabled={pending} onClick={onTurnOff}>
          {pending ? 'Turning off…' : 'Turn off'}
        </Button>
      </ItemActions>
    );
  }
  return null;
}

'use client';

import { DeviceNotificationsCard } from '@campuspilot/components/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  DevicePushError,
  readDeviceNotificationStatus,
  turnOffDeviceNotifications,
  turnOnDeviceNotifications,
} from '@/lib/web-push.client';

/** Browser and server state of this device; read in a query, never an effect. */
export const DEVICE_NOTIFICATIONS_QUERY_KEY = ['cadet', 'device-notifications'] as const;

function errorText(error: unknown) {
  if (error instanceof DevicePushError) return error.message;
  return 'Could not change notifications on this device. Try again.';
}

/** Device state plus the on/off mutations; both refresh the state when done. */
function useDeviceNotifications() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: DEVICE_NOTIFICATIONS_QUERY_KEY, queryFn: readDeviceNotificationStatus });
  const refresh = () => queryClient.invalidateQueries({ queryKey: DEVICE_NOTIFICATIONS_QUERY_KEY });
  const turnOn = useMutation({ mutationFn: turnOnDeviceNotifications, onSettled: refresh });
  const turnOff = useMutation({ mutationFn: turnOffDeviceNotifications, onSettled: refresh });
  return { status, turnOn, turnOff };
}

/**
 * "Turn on notifications" for the signed-in student on this device. The
 * permission request starts synchronously in the click handler (a user
 * gesture, required by Safari) and is handed to the mutation.
 */
export function CadetDeviceNotifications() {
  const { status, turnOn, turnOff } = useDeviceNotifications();
  const failure = turnOn.error ?? turnOff.error ?? null;
  const errorMessage = failure
    ? errorText(failure)
    : status.isError
      ? 'Could not check notifications on this device. Reload to try again.'
      : null;
  return (
    <DeviceNotificationsCard
      status={status.data ?? 'loading'}
      pending={turnOn.isPending || turnOff.isPending}
      errorMessage={errorMessage}
      onTurnOn={() => {
        turnOff.reset();
        turnOn.mutate(Notification.requestPermission());
      }}
      onTurnOff={() => {
        turnOn.reset();
        turnOff.mutate();
      }}
    />
  );
}

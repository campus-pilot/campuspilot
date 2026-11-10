import {
  DELIVERY_CHANNEL_LABELS,
  DELIVERY_SKIP_REASON_LABELS,
  type DeliveryChannel,
  type DeliverySkipReason,
} from './delivery-labels';

/** The API's forecast of a result send (D-26). */
export type DeliveryForecast = {
  recipientCount: number;
  channels: Record<DeliveryChannel, { owed: number; skipped: Partial<Record<DeliverySkipReason, number>> }>;
};

const CHANNEL_ORDER: DeliveryChannel[] = ['whatsapp', 'web_push'];

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function ChannelRow({ channel, forecast }: { channel: DeliveryChannel; forecast: DeliveryForecast['channels'][DeliveryChannel] }) {
  const skips = Object.entries(forecast.skipped).filter(([, count]) => (count ?? 0) > 0) as [DeliverySkipReason, number][];
  return (
    <li className="flex flex-col gap-1 rounded-md border p-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">{DELIVERY_CHANNEL_LABELS[channel]}</span>
        <span>{forecast.owed} to send</span>
      </div>
      {skips.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {skips.map(([reason, count]) => (
            <li key={reason} className="flex justify-between gap-2">
              <span>{DELIVERY_SKIP_REASON_LABELS[reason]}</span>
              <span className="shrink-0">{count} skipped</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * What a result send will do, per channel: copies to send and, for the
 * rest, why they will not be sent. Every student also gets the in-app
 * notification. Device-notification counts are per device.
 */
export function DeliveryForecastSummary({ forecast }: { forecast: DeliveryForecast }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        {plural(forecast.recipientCount, 'student', 'students')} will get an in-app notification.
      </p>
      <ul className="flex flex-col gap-2">
        {CHANNEL_ORDER.map((channel) => (
          <ChannelRow key={channel} channel={channel} forecast={forecast.channels[channel]} />
        ))}
      </ul>
    </div>
  );
}

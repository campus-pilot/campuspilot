/**
 * Staff-facing words for notification delivery facts, shared by the result
 * send confirmation and the delivery log. Records keyed by the API's enum
 * values, so a new channel, status or skip reason fails the build here.
 */

export type DeliveryChannel = 'web_push' | 'whatsapp';
export type DeliveryStatus = 'owed' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';
export type DeliverySkipReason = 'no_number' | 'not_verified' | 'no_consent' | 'opted_out' | 'no_subscription' | 'demo_school' | 'disabled' | 'feature_disabled';

export const DELIVERY_CHANNEL_LABELS: Record<DeliveryChannel, string> = {
  web_push: 'Device notification',
  whatsapp: 'WhatsApp',
};

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  owed: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
  skipped: 'Not sent',
};

export const DELIVERY_SKIP_REASON_LABELS: Record<DeliverySkipReason, string> = {
  no_number: 'No WhatsApp number',
  not_verified: 'WhatsApp number not verified',
  no_consent: 'No WhatsApp consent',
  opted_out: 'Opted out',
  no_subscription: 'Device notifications not turned on',
  demo_school: 'Demo school (never sent)',
  disabled: 'Channel switched off',
  feature_disabled: 'Feature switched off for this school',
};

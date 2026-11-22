import type { LeadDto } from '@campuspilot/api/routers/system-admin/lead/lead.dto';

export type LeadAlertStatus = LeadDto['alertStatus'];

export const alertStatusLabels: Record<LeadAlertStatus, string> = {
  pending: 'Pending',
  sent: 'Sent',
  failed: 'Failed',
};

export const alertStatusVariants: Record<LeadAlertStatus, 'secondary' | 'outline' | 'destructive'> = {
  pending: 'outline',
  sent: 'secondary',
  failed: 'destructive',
};

/** `approxStudents` → "Approx students": answers are shown by their JSON key, not by a per-question label. */
export function answerLabel(key: string) {
  // Brand words stay whole ("hasWhatsAppOnPhone" → "Has whatsapp on phone").
  const words = key.replace(/WhatsApp/g, 'Whatsapp').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Plain text of one stored answer, whatever its JSON type. */
export function answerText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

/** A text answer of a lead, for the table's summary columns. */
export function answer(lead: LeadDto, key: string) {
  const value = lead.response[key];
  return typeof value === 'string' && value ? value : null;
}

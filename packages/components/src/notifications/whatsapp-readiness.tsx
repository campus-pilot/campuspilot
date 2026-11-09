import { Badge } from '@campuspilot/ui/components/badge';

/**
 * Whether an admission can receive WhatsApp (D-4, D-8), from its three
 * stored facts, first failing fact wins — the same order the WhatsApp
 * channel and the admission list filter use: no number, then not
 * verified, then no consent.
 */
export type WhatsappReadiness = 'ready' | 'no_number' | 'not_verified' | 'no_consent';

export function whatsappReadiness(admission: { whatsappNo: string | null; whatsappVerified: boolean; whatsappConsent: boolean }): WhatsappReadiness {
  if (!admission.whatsappNo) return 'no_number';
  if (!admission.whatsappVerified) return 'not_verified';
  if (!admission.whatsappConsent) return 'no_consent';
  return 'ready';
}

export const WHATSAPP_READINESS_LABELS: Record<WhatsappReadiness, string> = {
  ready: 'Ready',
  no_number: 'No number',
  not_verified: 'Not verified',
  no_consent: 'No consent',
};

/** Compact WhatsApp readiness indicator for tables. */
export function WhatsappReadinessBadge({ readiness }: { readiness: WhatsappReadiness }) {
  return (
    <Badge variant={readiness === 'ready' ? 'secondary' : 'outline'} className={readiness === 'ready' ? undefined : 'text-amber-700 dark:text-amber-400'}>
      {WHATSAPP_READINESS_LABELS[readiness]}
    </Badge>
  );
}

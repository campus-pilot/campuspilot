import { z } from 'zod';

/**
 * Marketing leads (the website's demo request form, `/public/leads`).
 *
 * - `LEAD_ALERT_WHATSAPP_TO`: the CampusPilot team's own WhatsApp number in
 *   E.164 (`+917023908472`) that receives one alert per new lead, sent from
 *   the platform's WhatsApp Business number (`WHATSAPP_*`). Its own fact:
 *   not derived from the website's public contact number. It must not be
 *   the sending number itself, which Meta cannot message. Unset: leads are
 *   still saved, and their alert fails as not configured.
 * - `LEAD_CHALLENGE_HMAC_KEY`: signs the proof-of-work challenges the form
 *   solves before submitting (ALTCHA format). Shared by every API replica,
 *   so a challenge issued by one verifies on another. Required in
 *   production ({@link requireLeadChallengeKeyInProduction}); elsewhere an
 *   unset key is replaced by a random one per process.
 */
export const LEAD_ENV_SHAPE = {
  LEAD_ALERT_WHATSAPP_TO: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use E.164 with the + sign, e.g. +917023908472.').optional(),
  LEAD_CHALLENGE_HMAC_KEY: z.string().min(32, 'Use at least 32 characters (e.g. openssl rand -hex 32).').optional(),
};

/** Final-schema check: the challenge key is required in production. */
export function requireLeadChallengeKeyInProduction(
  value: { NODE_ENV?: string; LEAD_CHALLENGE_HMAC_KEY?: string },
  context: z.RefinementCtx,
) {
  if (value.NODE_ENV === 'production' && !value.LEAD_CHALLENGE_HMAC_KEY) {
    context.addIssue({
      code: 'custom',
      path: ['LEAD_CHALLENGE_HMAC_KEY'],
      message: 'LEAD_CHALLENGE_HMAC_KEY is required in production: it signs the demo form\'s proof-of-work challenges across replicas.',
    });
  }
}

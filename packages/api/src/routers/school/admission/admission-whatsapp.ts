import { isE164PhoneNumber } from "@campuspilot/db/phone";

/** The stored WhatsApp facts of an admission (D-4, D-8). */
export type AdmissionWhatsappState = {
  whatsappNo: string | null;
  whatsappSameAsPhone: boolean | null;
  whatsappVerified: boolean;
  whatsappConsent: boolean;
};

/** The phone and WhatsApp values a create or update supplies (undefined = unchanged). */
export type AdmissionContactChanges = {
  phoneNo?: string;
  whatsappNo?: string | null;
  whatsappSameAsPhone?: boolean;
  whatsappVerified?: boolean;
  whatsappConsent?: boolean;
};

/** A request that cannot be stored; the message is safe to show. */
export class AdmissionContactError extends Error {
  override name = "AdmissionContactError";
}

/**
 * Resolves the WhatsApp facts to store after a create (`current` null) or an
 * update, from the stored row and the supplied changes. Rules, in order:
 *
 * 1. `whatsappSameAsPhone` is whatever was supplied, else what is stored.
 *    Stored null means "no choice ever recorded" (a row from before Phase 1b
 *    that the phone backfill has not reached yet; the backfill only visits
 *    null rows). An update of such a row that supplies a WhatsApp number or
 *    verification without the choice records `false` (the number is its own
 *    value), so the backfill can never overwrite what staff entered. An
 *    update that touches neither keeps null: the backfill still owns it.
 * 2. While it is true, the WhatsApp number is the (new) phone number: a
 *    different supplied `whatsappNo` is refused, and so is a phone number
 *    that is not valid E.164 (an unmigrated legacy value cannot become a
 *    WhatsApp number).
 * 3. Otherwise the WhatsApp number is the supplied one, else the stored one;
 *    unticking "same as phone" keeps the stored number as an independent value.
 * 4. Verification belongs to one number: when the WhatsApp number changes and
 *    the request does not say whether the new number is verified, it is reset
 *    to false. A number that does not exist cannot be verified.
 * 5. Consent belongs to the guardian, not the number: it changes only when
 *    supplied.
 */
export function resolveAdmissionWhatsapp(
  current: (AdmissionWhatsappState & { phoneNo: string }) | null,
  changes: AdmissionContactChanges,
): AdmissionWhatsappState {
  const phoneNo = changes.phoneNo ?? current?.phoneNo;
  const touchesWhatsapp = changes.whatsappNo !== undefined || changes.whatsappVerified !== undefined;
  const sameAsPhone =
    changes.whatsappSameAsPhone ??
    current?.whatsappSameAsPhone ??
    (touchesWhatsapp ? false : null);
  let whatsappNo: string | null;
  if (sameAsPhone === true) {
    if (!phoneNo || !isE164PhoneNumber(phoneNo)) {
      throw new AdmissionContactError(
        "Correct the phone number before using it as the WhatsApp number.",
      );
    }
    if (changes.whatsappNo != null && changes.whatsappNo !== phoneNo) {
      throw new AdmissionContactError(
        "The WhatsApp number must equal the phone number while it is the same as the phone number.",
      );
    }
    whatsappNo = phoneNo;
  } else {
    whatsappNo = changes.whatsappNo !== undefined ? changes.whatsappNo : (current?.whatsappNo ?? null);
  }
  const numberChanged = whatsappNo !== (current?.whatsappNo ?? null);
  const whatsappVerified =
    changes.whatsappVerified ?? (numberChanged ? false : (current?.whatsappVerified ?? false));
  if (whatsappVerified && whatsappNo === null) {
    throw new AdmissionContactError("A WhatsApp number can only be verified when there is one.");
  }
  return {
    whatsappNo,
    whatsappSameAsPhone: sameAsPhone,
    whatsappVerified,
    whatsappConsent: changes.whatsappConsent ?? current?.whatsappConsent ?? false,
  };
}

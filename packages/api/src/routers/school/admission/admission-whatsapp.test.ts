import { formatPhoneNumberForDisplay, isE164PhoneNumber, phoneNumberSchema, toE164PhoneNumber } from "@campuspilot/db/phone";
import { describe, expect, it } from "vitest";

import { AdmissionContactError, resolveAdmissionWhatsapp } from "./admission-whatsapp";

const stored = {
  phoneNo: "+919876543210",
  whatsappNo: "+919876543210",
  whatsappSameAsPhone: true,
  whatsappVerified: true,
  whatsappConsent: true,
};

describe("phone numbers", () => {
  it("reads national Indian numbers and international numbers into E.164", () => {
    expect(toE164PhoneNumber("98765 43210")).toBe("+919876543210");
    expect(toE164PhoneNumber("098765-43210")).toBe("+919876543210");
    expect(toE164PhoneNumber("+1 415 555 2671")).toBe("+14155552671");
    expect(toE164PhoneNumber("12345")).toBeNull();
    expect(toE164PhoneNumber("9876543210 / 9123456789")).toBeNull();
    expect(phoneNumberSchema.parse(" 9876543210 ")).toBe("+919876543210");
    expect(phoneNumberSchema.safeParse("not a number").success).toBe(false);
  });

  it("recognises stored E.164 values and displays unmigrated values unchanged", () => {
    expect(isE164PhoneNumber("+919876543210")).toBe(true);
    expect(isE164PhoneNumber("9876543210")).toBe(false);
    expect(formatPhoneNumberForDisplay("+919876543210")).toBe("+91 98765 43210");
    expect(formatPhoneNumberForDisplay("+91 call the office")).toBe("+91 call the office");
    expect(formatPhoneNumberForDisplay("9876543210")).toBe("9876543210");
  });
});

describe("resolveAdmissionWhatsapp", () => {
  it("copies the phone number while same-as-phone is chosen on create", () => {
    expect(resolveAdmissionWhatsapp(null, { phoneNo: "+919876543210", whatsappSameAsPhone: true, whatsappVerified: true, whatsappConsent: false }))
      .toEqual({ whatsappNo: "+919876543210", whatsappSameAsPhone: true, whatsappVerified: true, whatsappConsent: false });
  });

  it("keeps an independent number when same-as-phone is not chosen", () => {
    expect(resolveAdmissionWhatsapp(null, { phoneNo: "+919876543210", whatsappSameAsPhone: false, whatsappNo: "+919123456789" }))
      .toEqual({ whatsappNo: "+919123456789", whatsappSameAsPhone: false, whatsappVerified: false, whatsappConsent: false });
    expect(resolveAdmissionWhatsapp(null, { phoneNo: "+919876543210", whatsappSameAsPhone: false }).whatsappNo).toBeNull();
  });

  it("follows a phone change and resets verification for the new number unless stated", () => {
    expect(resolveAdmissionWhatsapp(stored, { phoneNo: "+919123456789" }))
      .toEqual({ whatsappNo: "+919123456789", whatsappSameAsPhone: true, whatsappVerified: false, whatsappConsent: true });
    expect(resolveAdmissionWhatsapp(stored, { phoneNo: "+919123456789", whatsappVerified: true }).whatsappVerified).toBe(true);
  });

  it("keeps the stored number as independent when same-as-phone is unticked", () => {
    expect(resolveAdmissionWhatsapp(stored, { whatsappSameAsPhone: false }))
      .toEqual({ whatsappNo: "+919876543210", whatsappSameAsPhone: false, whatsappVerified: true, whatsappConsent: true });
  });

  it("refuses inconsistent or impossible combinations", () => {
    expect(() => resolveAdmissionWhatsapp(stored, { whatsappNo: "+919123456789" })).toThrow(AdmissionContactError);
    expect(() => resolveAdmissionWhatsapp(null, { phoneNo: "+919876543210", whatsappSameAsPhone: false, whatsappVerified: true }))
      .toThrow("can only be verified");
    // An unmigrated legacy phone value cannot become the WhatsApp number.
    const legacy = { ...stored, phoneNo: "+91 call the office", whatsappNo: null, whatsappSameAsPhone: false, whatsappVerified: false };
    expect(() => resolveAdmissionWhatsapp(legacy, { whatsappSameAsPhone: true })).toThrow("Correct the phone number");
  });

  it("leaves a never-recorded choice untouched by unrelated changes", () => {
    const legacy = { phoneNo: "9876543210", whatsappNo: null, whatsappSameAsPhone: null, whatsappVerified: false, whatsappConsent: false };
    expect(resolveAdmissionWhatsapp(legacy, { whatsappConsent: true }))
      .toEqual({ whatsappNo: null, whatsappSameAsPhone: null, whatsappVerified: false, whatsappConsent: true });
  });

  it("records an explicit choice when a never-recorded row gets a WhatsApp number, so the backfill cannot overwrite it", () => {
    const legacy = { phoneNo: "9876543210", whatsappNo: null, whatsappSameAsPhone: null, whatsappVerified: false, whatsappConsent: false };
    expect(resolveAdmissionWhatsapp(legacy, { whatsappNo: "+919123456789", whatsappVerified: true }))
      .toEqual({ whatsappNo: "+919123456789", whatsappSameAsPhone: false, whatsappVerified: true, whatsappConsent: false });
    expect(resolveAdmissionWhatsapp(legacy, { whatsappNo: null }).whatsappSameAsPhone).toBe(false);
  });
});

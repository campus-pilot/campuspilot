import assert from "node:assert/strict";
import { test } from "node:test";
import { canOfferPaymentDiscount } from "./payment-dialog-permissions";

test("payment discounts require one successful affirmative adjustment check", () => {
  assert.equal(
    canOfferPaymentDiscount({ isSuccess: true, results: [true] }),
    true,
  );
});

test("payment discounts fail closed for unresolved, failed, denied, or malformed checks", () => {
  assert.equal(
    canOfferPaymentDiscount({ isSuccess: false, results: undefined }),
    false,
  );
  assert.equal(
    canOfferPaymentDiscount({ isSuccess: false, results: [true] }),
    false,
  );
  assert.equal(
    canOfferPaymentDiscount({ isSuccess: true, results: [false] }),
    false,
  );
  assert.equal(
    canOfferPaymentDiscount({ isSuccess: true, results: [] }),
    false,
  );
  assert.equal(
    canOfferPaymentDiscount({ isSuccess: true, results: [true, true] }),
    false,
  );
});

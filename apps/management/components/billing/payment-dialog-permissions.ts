export type PaymentDiscountPermissionState = {
  isSuccess: boolean;
  results: readonly boolean[] | undefined;
};

/**
 * Exposes payment discounts only after the single independent adjustment
 * permission check succeeds with an exact affirmative result.
 */
export function canOfferPaymentDiscount({
  isSuccess,
  results,
}: PaymentDiscountPermissionState) {
  return isSuccess && results?.length === 1 && results[0] === true;
}

import { expect } from 'vitest';

/** Asserts the stable oRPC error code without coupling tests to message text. */
export async function expectRpcCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toThrowError(expect.objectContaining({ code }));
}

/** Ensures a general resource cannot accidentally serialize restricted pricing. */
export function expectNoFinanceValue(value: unknown): void {
  expect(value).not.toHaveProperty('financeValue');
}

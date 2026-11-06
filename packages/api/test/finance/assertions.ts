import { expect } from 'vitest';
import { isRetryableTransactionError } from '../../src/errors';

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

/**
 * Retries an idempotent finance command after a serialization conflict, as a
 * real client (or the demo workflow's step retries) would. Serializable
 * finance transactions in parallel test files can conflict with each other.
 */
export async function retryFinanceConflict<T>(command: () => Promise<T>, attempts = 6): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await command();
    } catch (error) {
      const conflict = typeof error === 'object' && error !== null && 'code' in error && error.code === 'CONFLICT'
        && 'cause' in error && isRetryableTransactionError(error.cause);
      if (!conflict || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}

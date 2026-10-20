import { ORPCError } from "@orpc/server";

type DatabaseError = {
  code?: unknown;
  cause?: unknown;
  constraint?: unknown;
};

function isDatabaseError(error: unknown): error is DatabaseError {
  return typeof error === "object" && error !== null && "code" in error;
}

function findDatabaseError(
  error: unknown,
  expectedCode: string,
): DatabaseError | undefined {
  let current = error;
  const visited = new Set<object>();

  while (typeof current === "object" && current !== null) {
    if (visited.has(current)) return undefined;
    visited.add(current);

    if (isDatabaseError(current) && current.code === expectedCode) {
      return current;
    }

    current = "cause" in current ? current.cause : undefined;
  }

  return undefined;
}

/** True when PostgreSQL requires the complete transaction to be replayed. */
export function isRetryableTransactionError(error: unknown): boolean {
  return Boolean(findDatabaseError(error, "40001") ?? findDatabaseError(error, "40P01"));
}

export const rpcError = {
  badRequest: (message: string, cause?: unknown) =>
    new ORPCError("BAD_REQUEST", { message, cause }),
  unauthorized: () => new ORPCError("UNAUTHORIZED"),
  forbidden: (message?: string) => new ORPCError("FORBIDDEN", { message }),
  notFound: (resource: string) =>
    new ORPCError("NOT_FOUND", { message: `${resource} was not found.` }),
  conflict: (message: string, cause?: unknown) =>
    new ORPCError("CONFLICT", { message, cause }),
  payloadTooLarge: (message: string) =>
    new ORPCError("PAYLOAD_TOO_LARGE", { message }),
  unsupportedMediaType: (message: string) =>
    new ORPCError("UNSUPPORTED_MEDIA_TYPE", { message }),
  internal: (cause?: unknown) =>
    new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "An unexpected server error occurred.",
      cause,
    }),
};

/**
 * Converts infrastructure failures into stable RPC errors. Drizzle preserves
 * the PostgreSQL error as a nested cause, so the cause chain is inspected for
 * canonical unique and retryable transaction codes. Other implementation
 * details remain private behind INTERNAL_SERVER_ERROR.
 */
export function toRpcError(error: unknown): ORPCError<string, unknown> {
  if (error instanceof ORPCError) return error;

  const uniqueViolation = findDatabaseError(error, "23505");
  if (uniqueViolation) {
    return rpcError.conflict(
      "A resource with those unique values already exists.",
      uniqueViolation,
    );
  }

  const serializationFailure = findDatabaseError(error, "40001");
  const deadlockDetected = findDatabaseError(error, "40P01");
  if (serializationFailure || deadlockDetected) {
    return rpcError.conflict(
      "The operation conflicted with another finance update. Retry the same idempotent command.",
      serializationFailure ?? deadlockDetected,
    );
  }

  return rpcError.internal(error);
}

export function rpcErrorResponse(error: unknown): Response {
  const rpcFailure = toRpcError(error);
  return Response.json(
    { code: rpcFailure.code, message: rpcFailure.message },
    { status: rpcFailure.status },
  );
}

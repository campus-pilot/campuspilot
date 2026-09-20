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

export const rpcError = {
  badRequest: (message: string, cause?: unknown) =>
    new ORPCError("BAD_REQUEST", { message, cause }),
  unauthorized: () => new ORPCError("UNAUTHORIZED"),
  forbidden: () => new ORPCError("FORBIDDEN"),
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
 * the canonical 23505 unique-constraint code. All other implementation details
 * remain private behind INTERNAL_SERVER_ERROR.
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

  return rpcError.internal(error);
}

export function rpcErrorResponse(error: unknown): Response {
  const rpcFailure = toRpcError(error);
  return Response.json(
    { code: rpcFailure.code, message: rpcFailure.message },
    { status: rpcFailure.status },
  );
}

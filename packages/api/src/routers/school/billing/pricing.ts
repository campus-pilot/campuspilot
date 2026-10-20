import {
  financeSchemaConfigSchema,
  type FinanceClassOverrides,
  type FinanceElement,
  type FinanceSchemaConfig,
  type FinanceValuesMap,
} from "@campuspilot/db/schema/jsonb/finance-config";

export type BillingPricingSourceKind =
  | "admission"
  | "class"
  | "session"
  | "run_class"
  | "run_session"
  | "fallback";

export type ResolvedBillingPrice = {
  amountMinor: bigint;
  sourceKind: BillingPricingSourceKind;
  sourceKey: string;
  sourceSnapshot: {
    kind: BillingPricingSourceKind;
    key: string;
    amountMinor: string;
  };
};

export type BillingPricingContext = {
  sessionId: string;
  admissionId: string;
  classId: string;
  classSlug: string;
  admissionValues: FinanceValuesMap;
  classOverrides: FinanceClassOverrides;
  runSessionValues: Record<string, string>;
  runClassValues: Record<string, Record<string, string>>;
};

/** Captures every precedence candidate, including explicit zero and absence. */
export function snapshotBillingPriceResolution(
  elementSlug: string,
  element: FinanceElement,
  context: BillingPricingContext,
): Record<string, unknown> {
  const admission = configuredNumber(context.admissionValues, elementSlug);
  const persistedClass = configuredNumber(
    context.classOverrides[context.classSlug],
    elementSlug,
  );
  const runClass = configuredString(
    context.runClassValues[context.classId],
    elementSlug,
  );
  const runSession = configuredString(context.runSessionValues, elementSlug);
  return {
    elementSlug,
    requiredAtLevel: element.requiredAtLevel ?? null,
    allowedScopes: [...element.scopes],
    candidates: {
      admission: admission === undefined ? null : String(admission),
      class: persistedClass === undefined ? null : String(persistedClass),
      runClass: runClass ?? null,
      runSession: runSession ?? null,
      fallback:
        element.defaultAmountMinor === undefined
          ? null
          : String(element.defaultAmountMinor),
    },
  };
}

export type BillingConfigurationIssue = {
  path: string;
  message: string;
};

/**
 * Billing accepts only the complete Phase 2 configuration shape. This pure
 * validator intentionally returns issues rather than throwing so preview can
 * group configuration failures without making any writes.
 */
export function validateBillingConfiguration(
  value: unknown,
):
  | { valid: true; config: FinanceSchemaConfig; issues: [] }
  | { valid: false; config: null; issues: BillingConfigurationIssue[] } {
  const parsed = financeSchemaConfigSchema.safeParse(value);
  if (parsed.success) return { valid: true, config: parsed.data, issues: [] };

  return {
    valid: false,
    config: null,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

function resolved(
  amountMinor: bigint,
  sourceKind: BillingPricingSourceKind,
  sourceKey: string,
): ResolvedBillingPrice {
  return {
    amountMinor,
    sourceKind,
    sourceKey,
    sourceSnapshot: {
      kind: sourceKind,
      key: sourceKey,
      amountMinor: amountMinor.toString(10),
    },
  };
}

function configuredNumber(
  values: FinanceValuesMap | undefined,
  elementSlug: string,
): number | undefined {
  // Property membership, rather than truthiness, preserves an explicit zero.
  return values && Object.hasOwn(values, elementSlug)
    ? values[elementSlug]
    : undefined;
}

function configuredString(
  values: Record<string, string> | undefined,
  elementSlug: string,
): string | undefined {
  return values && Object.hasOwn(values, elementSlug)
    ? values[elementSlug]
    : undefined;
}

/**
 * Resolves one fee element with the approved, non-interchangeable precedence.
 * Ordinary pricing never consumes run inputs. Bill-generation inputs never
 * overwrite persisted ordinary pricing. The returned source snapshot is safe
 * to copy directly into an immutable bill line.
 */
export function resolveBillingPrice(
  elementSlug: string,
  element: FinanceElement,
  context: BillingPricingContext,
): ResolvedBillingPrice | null {
  const admissionAmount = configuredNumber(
    context.admissionValues,
    elementSlug,
  );

  if (element.requiredAtLevel === "bill_generation") {
    const classAmount = configuredString(
      context.runClassValues[context.classId],
      elementSlug,
    );
    if (element.scopes.includes("class") && classAmount !== undefined) {
      return resolved(
        BigInt(classAmount),
        "run_class",
        `${context.classId}:${elementSlug}`,
      );
    }

    const sessionAmount = configuredString(
      context.runSessionValues,
      elementSlug,
    );
    if (element.scopes.includes("school") && sessionAmount !== undefined) {
      return resolved(
        BigInt(sessionAmount),
        "run_session",
        `${context.sessionId}:${elementSlug}`,
      );
    }
    // Bill-generation elements are opt-in command values. Persisted admission
    // values and configured defaults must not silently add an optional charge
    // when the operator leaves this run blank.
    return null;
  }

  if (element.scopes.includes("student") && admissionAmount !== undefined) {
    return resolved(
      BigInt(admissionAmount),
      "admission",
      `${context.sessionId}:${context.admissionId}:${elementSlug}`,
    );
  }

  const classAmount = configuredNumber(
    context.classOverrides[context.classSlug],
    elementSlug,
  );
  if (element.scopes.includes("class") && classAmount !== undefined) {
    return resolved(
      BigInt(classAmount),
      "class",
      `${context.sessionId}:${context.classSlug}:${elementSlug}`,
    );
  }

  if (element.defaultAmountMinor !== undefined) {
    return resolved(
      BigInt(element.defaultAmountMinor),
      "session",
      `${context.sessionId}:${elementSlug}`,
    );
  }

  return null;
}

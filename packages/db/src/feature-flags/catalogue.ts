import { z } from "zod";

import { roleEnum } from "../schema/jsonb/role";

/**
 * The school feature catalogue: the single authority on which per-school
 * platform features exist and what configuration each one carries. A platform
 * administrator switches a feature on or off for one school (admin app); the
 * school cannot change it itself.
 *
 * It lives in `@campuspilot/db` because it is the contract of the
 * `school_feature_flag.config` jsonb column and must be importable by the
 * API, the auth package and the browser apps alike (same precedent as
 * `@campuspilot/db/notifications/catalogue`). It imports nothing but Zod
 * (and the school role names, themselves only a Zod enum).
 *
 * Adding a feature: add one entry here. Every consumer is a
 * `Record<SchoolFeatureKey, …>` or is derived from this object, so the build
 * fails until each one handles the new key. Rules:
 * - each key has exactly one `config` schema; a caller holding key `K` only
 *   ever receives `SchoolFeatureConfig<K>`, never another key's shape;
 * - a feature without settings declares `config: z.null()`;
 * - a missing row means `{ enabled: false, config: null }`: new features are
 *   off for every school until an administrator enables them (a migration may
 *   backfill rows when an already-live capability becomes a feature);
 * - `enabled` and `config` are independent facts: disabling a feature keeps
 *   its stored config.
 * Retiring a feature: remove its entry; stored rows of the retired key are
 * ignored by every read.
 */
export const schoolFeatureCatalogue = {
  cadet: {
    label: "Cadet Portal",
    description:
      "Students sign in to the Cadet Portal to see their fees, released results and notifications, and staff can issue portal passwords.",
    config: z.null(),
  },
  notices: {
    label: "Notices",
    description:
      "Staff write and publish school notices to staff and, when the Cadet Portal is enabled, to students.",
    config: z.null(),
  },
  assistant: {
    label: "AI assistant",
    description:
      "Staff ask the in-app assistant to read and change school data as themselves.",
    config: z.object({
      /**
       * The school's spend on the assistant per calendar month (IST, the 1st
       * to the last day), in USD; null means no limit. Once the month's
       * saved model-request costs reach it, nobody in the school can start
       * or continue a turn until the next month.
       */
      monthlyLimitUsd: z.number().positive().max(1_000_000).nullable(),
      /**
       * The school roles the platform lets this school open the assistant
       * to (the ceiling). The school itself switches each of these roles on
       * or off (`school_assistant_access_role`); a role outside this list
       * grants nothing even if the school switched it on.
       */
      eligibleRoles: z
        .array(roleEnum)
        .min(1)
        .refine((roles) => new Set(roles).size === roles.length, "Name each role once."),
    }),
  },
} as const satisfies Record<
  string,
  { label: string; description: string; config: z.ZodType }
>;

export type SchoolFeatureKey = keyof typeof schoolFeatureCatalogue;

/** Every feature key, in catalogue order. */
export const SCHOOL_FEATURE_KEYS = Object.keys(
  schoolFeatureCatalogue,
) as [SchoolFeatureKey, ...SchoolFeatureKey[]];

export const schoolFeatureKeySchema = z.enum(SCHOOL_FEATURE_KEYS);

/** The configuration type of exactly one feature. */
export type SchoolFeatureConfig<K extends SchoolFeatureKey> = z.infer<
  (typeof schoolFeatureCatalogue)[K]["config"]
>;

/**
 * One feature's state for one school. `config` is null when nothing is
 * stored (or the feature has no settings); it is kept while the feature is
 * disabled, so `enabled` must be checked on its own.
 */
export type SchoolFeatureState<K extends SchoolFeatureKey> = {
  enabled: boolean;
  config: SchoolFeatureConfig<K> | null;
};

/** Every feature's state for one school, keyed by feature. */
export type SchoolFeatureFlags = {
  [K in SchoolFeatureKey]: SchoolFeatureState<K>;
};

/** The shape every feature catalogue entry has. */
type FeatureCatalogueShape = Record<
  string,
  { label: string; description: string; config: z.ZodType }
>;

/**
 * One feature's state **with its key**, as a union discriminated on
 * `feature`: `{ feature: 'cadet'; config: CadetConfig } | { feature:
 * 'notices'; config: NoticesConfig }`. This is the type to use whenever the
 * key is not a literal (a loop over `SCHOOL_FEATURE_KEYS`, an admin form):
 * a value whose `feature` is the whole key union cannot carry one feature's
 * config for another, because each member pairs a key with its own config.
 * `SchoolFeatureState<K>` alone cannot give that guarantee once `K` widens
 * to the union.
 *
 * Generic over the catalogue so the guarantee is testable against a
 * catalogue whose configs differ (`catalogue.test.ts`); application code uses
 * `SchoolFeatureEntry`.
 */
export type FeatureEntryIn<C extends FeatureCatalogueShape> = {
  [K in keyof C]: {
    feature: K;
    enabled: boolean;
    config: z.infer<C[K]["config"]> | null;
  };
}[keyof C];

/** One catalogue feature's keyed state (see `FeatureEntryIn`). */
export type SchoolFeatureEntry = FeatureEntryIn<typeof schoolFeatureCatalogue>;

/**
 * A school's flags as keyed entries, in catalogue order. Each entry keeps
 * its key and its own config together, so callers iterate without casting.
 */
export function schoolFeatureEntries(
  flags: SchoolFeatureFlags,
): SchoolFeatureEntry[] {
  return SCHOOL_FEATURE_KEYS.map(
    (feature) => ({ feature, ...flags[feature] }) as SchoolFeatureEntry,
  );
}

/** The state of a feature that has no stored row. */
export const DISABLED_SCHOOL_FEATURE = { enabled: false, config: null } as const;

/**
 * Validates a stored or submitted config against the schema of `key` only.
 * Throws a `ZodError` when the value does not match that feature's schema.
 * A null value is always accepted as "no config stored".
 */
export function parseSchoolFeatureConfig<K extends SchoolFeatureKey>(
  key: K,
  raw: unknown,
): SchoolFeatureConfig<K> | null {
  if (raw === null || raw === undefined) return null;
  const schema: z.ZodType = schoolFeatureCatalogue[key].config;
  return schema.parse(raw) as SchoolFeatureConfig<K>;
}

/** Whether a feature declares settings (its config schema is not `z.null()`). */
export function schoolFeatureHasConfig(key: SchoolFeatureKey): boolean {
  return !(schoolFeatureCatalogue[key].config instanceof z.ZodNull);
}

/** The Zod schema type of one feature's state, with that key's config only. */
type SchoolFeatureStateSchema<K extends SchoolFeatureKey> = z.ZodObject<{
  enabled: z.ZodBoolean;
  config: z.ZodNullable<(typeof schoolFeatureCatalogue)[K]["config"]>;
}>;

/**
 * Zod schema of one feature's state, typed per key. The return type is
 * stated: inferred, TypeScript widens `schoolFeatureCatalogue[key]` to every
 * key's config, so one feature's state would accept another's settings.
 */
export function schoolFeatureStateSchema<K extends SchoolFeatureKey>(key: K): SchoolFeatureStateSchema<K> {
  return z.object({
    enabled: z.boolean(),
    config: schoolFeatureCatalogue[key].config.nullable(),
  }) as unknown as SchoolFeatureStateSchema<K>;
}

/**
 * `data.reason` of the CONFLICT error thrown to code that needs a feature's
 * config when the stored value no longer matches the feature's schema. Only
 * that code is stopped; whether the feature is enabled is still answered.
 */
export const SCHOOL_FEATURE_CONFIG_INVALID_REASON = "SCHOOL_FEATURE_CONFIG_INVALID";

/** Zod schema of every feature's state for one school (API output). */
export const schoolFeatureFlagsSchema = z.object(
  Object.fromEntries(
    SCHOOL_FEATURE_KEYS.map((key) => [key, schoolFeatureStateSchema(key)]),
  ) as { [K in SchoolFeatureKey]: ReturnType<typeof schoolFeatureStateSchema<K>> },
);

/**
 * One feature's new state as a discriminated union on `feature`, so a
 * submitted config is validated against that feature's schema only.
 */
export const schoolFeatureUpdateSchema = z.discriminatedUnion(
  "feature",
  SCHOOL_FEATURE_KEYS.map((key) =>
    z.object({
      feature: z.literal(key),
      enabled: z.boolean(),
      config: schoolFeatureCatalogue[key].config.nullable(),
    }),
  ) as unknown as [
    SchoolFeatureUpdateOption<"cadet">,
    ...SchoolFeatureUpdateOption<SchoolFeatureKey>[],
  ],
);

type SchoolFeatureUpdateOption<K extends SchoolFeatureKey> = K extends unknown
  ? z.ZodObject<{
      feature: z.ZodLiteral<K>;
      enabled: z.ZodBoolean;
      config: z.ZodNullable<(typeof schoolFeatureCatalogue)[K]["config"]>;
    }>
  : never;

export type SchoolFeatureUpdate = z.infer<typeof schoolFeatureUpdateSchema>;

/**
 * `data.reason` of the FORBIDDEN error every API surface (staff RPC, cadet
 * RPC) throws when a school's feature is disabled. It is a stable contract:
 * clients tell "feature is off" from "you lack permission" by this value,
 * never by the message.
 */
export const SCHOOL_FEATURE_DISABLED_REASON = "SCHOOL_FEATURE_DISABLED";

/** `data` of the feature-disabled FORBIDDEN error. */
export const schoolFeatureDisabledDataSchema = z.object({
  reason: z.literal(SCHOOL_FEATURE_DISABLED_REASON),
  feature: schoolFeatureKeySchema,
});
export type SchoolFeatureDisabledData = z.infer<
  typeof schoolFeatureDisabledDataSchema
>;

/**
 * Reads the disabled feature out of a caught API error, or null when the
 * error is anything else. Works on the server's `ORPCError` and on the
 * client's deserialized copy alike (both expose `code` and `data`).
 */
export function readSchoolFeatureDisabled(
  error: unknown,
): SchoolFeatureKey | null {
  if (typeof error !== "object" || error === null) return null;
  if (!("code" in error) || error.code !== "FORBIDDEN") return null;
  if (!("data" in error)) return null;
  const parsed = schoolFeatureDisabledDataSchema.safeParse(error.data);
  return parsed.success ? parsed.data.feature : null;
}

import { z } from "zod";

import { roleEnum } from "../schema/jsonb/role";

/**
 * The school feature catalogue: the single authority on which per-school
 * platform features exist, which subscription tiers include each one and
 * what configuration each one carries. A school has the features of its tier
 * (`school.tier`); a platform administrator can adjust one feature for one
 * school on top of that (admin app). The school cannot change either itself.
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
 * - `tiers` names the subscription tiers that include the feature. It is the
 *   switch of a school without an adjustment: on when the school's tier is
 *   listed. A feature in no tier is an add-on: off for every school until an
 *   administrator switches it on for that school (the assistant, which needs
 *   its spend limit first). The list is explicit per feature and never
 *   derived from the order of the tiers;
 * - `requires` names the features this one cannot work without. A feature
 *   is **active** only while its own switch is on and every feature it
 *   requires is active ({@link resolveSchoolFeatureActivity}). Each switch
 *   is kept as it is: switching a required feature off makes the features
 *   that need it inactive without touching their switches, and switching it
 *   back on restores them;
 * - a school's adjustment (`school_feature_flag.enabled`: on, off, or null
 *   for "follow the tier") and `config` are independent facts: disabling a
 *   feature, or returning it to its tier, keeps its stored config.
 * Retiring a feature: remove its entry; stored rows of the retired key are
 * ignored by every read.
 */
/**
 * The subscription tiers a school can be on, lowest first. A school is on
 * at most one (`school.tier`; null: no subscribed tier); what a tier includes is stated per feature in
 * the catalogue below (`tiers`), so the two can never disagree.
 */
export const SCHOOL_TIERS = ["plus", "pro", "enterprise"] as const;

export type SchoolTier = (typeof SCHOOL_TIERS)[number];

export const schoolTierSchema = z
  .enum(SCHOOL_TIERS)
  .describe("The subscription tier of a school");

/** What each tier is called and what it is for, as the admin app shows it. */
export const schoolTierCatalogue = {
  plus: {
    label: "Plus",
    description:
      "A staff-only school: staff, classes, sections, subjects and examinations, with question papers once the AI assistant is switched on.",
  },
  pro: {
    label: "Pro",
    description:
      "Everything in Plus, with student management (admissions, fees and billing, results, timetables, student documents) and notices.",
  },
  enterprise: {
    label: "Enterprise",
    description:
      "Everything in Pro, with the Cadet Portal for students and WhatsApp notifications to guardians.",
  },
} as const satisfies Record<SchoolTier, { label: string; description: string }>;

/** The shape every feature catalogue entry has. */
type FeatureCatalogueShape = Record<
  string,
  {
    label: string;
    description: string;
    config: z.ZodType;
    /** The subscription tiers that include the feature (see the rules above). */
    tiers: readonly SchoolTier[];
    /** Features this one needs to be active; see the rules above. */
    requires: readonly string[];
  }
>;

export const schoolFeatureCatalogue = {
  studentManagement: {
    label: "Student management",
    description:
      "Admissions, students in classes, fees and billing, results, examination timetables and attendance, and student documents. Without it the school manages staff, classes, sections, subjects and examinations (for question papers) only.",
    config: z.null(),
    tiers: ["pro", "enterprise"],
    requires: [],
  },
  cadet: {
    label: "Cadet Portal",
    description:
      "Students sign in to the Cadet Portal to see their fees, released results and notifications, and staff can issue portal passwords.",
    config: z.null(),
    tiers: ["enterprise"],
    // The portal is the students' own; a school without students has none.
    requires: ["studentManagement"],
  },
  notices: {
    label: "Notices",
    description:
      "Staff write and publish school notices to staff and, when the Cadet Portal is enabled, to students.",
    config: z.null(),
    tiers: ["pro", "enterprise"],
    // A product decision: a school without student management has no notices.
    requires: ["studentManagement"],
  },
  whatsapp: {
    label: "WhatsApp notifications",
    description:
      "Guardians receive the school's notifications (bills, payments, results, timetables and notices) on WhatsApp, besides the inbox and web push.",
    config: z.null(),
    tiers: ["enterprise"],
    // Every WhatsApp message is about a student, to that student's guardian.
    requires: ["studentManagement"],
  },
  assistant: {
    label: "AI assistant",
    description:
      "Staff ask the in-app assistant to read and change school data as themselves, and generate question papers with it.",
    // An add-on on every tier: no tier switches it on by itself, because
    // every request is paid model usage. An administrator switches it on per
    // school together with its monthly limit.
    tiers: [],
    requires: [],
    config: z.object({
      /**
       * The school's spend on the assistant per calendar month (IST, the 1st
       * to the last day), in USD; null means no limit. Once the month's
       * saved model-request costs reach it, nobody in the school can start
       * or continue a turn until the next month.
       */
      monthlyLimitUsd: z.number().positive().max(1_000_000).nullable(),
      // Which roles may use the assistant is not a setting here: it is the
      // school's one role list (`school_assistant_access_role`), which the
      // platform administrator and the school's principal both edit. A config
      // saved before that still carries `eligibleRoles`; it is ignored.
      /**
       * Voice mode: talking to the assistant and hearing it answer. Its own
       * switch inside the assistant feature, so a school can have the assistant
       * without voice. It only narrows: voice also needs the assistant itself
       * (this feature active, the user's role, the monthly limit) and a voice
       * model configured on the platform. Rows saved before voice existed have
       * no `voice` and read as off.
       */
      voice: z.object({ enabled: z.boolean() }).default({ enabled: false }),
    }),
  },
} as const satisfies Record<string, FeatureCatalogueShape[string]>;

export type SchoolFeatureKey = keyof typeof schoolFeatureCatalogue;

/**
 * The roles the assistant is switched on for when an administrator enables
 * it for a school that has no role switched on yet: the principal, the
 * manager, the exam coordinator and the accountant. Teachers are left for
 * the school (or the administrator) to add. Written once, at that moment;
 * afterwards the school's role list is whatever was last saved.
 */
export const ASSISTANT_DEFAULT_ROLES = [
  "principal",
  "manager",
  "exam_coordinator",
  "accountant",
] as const satisfies readonly z.infer<typeof roleEnum>[];

/**
 * Compile-time guard: every name in a `requires` list is a catalogue key.
 * (Cycles are refused by `catalogue.test.ts`.)
 */
type RequiredFeatureKey =
  (typeof schoolFeatureCatalogue)[SchoolFeatureKey]["requires"][number];
const requiresNameFeatures: RequiredFeatureKey extends SchoolFeatureKey ? true : never = true;
void requiresNameFeatures;

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
 * One feature's configuration as it may be written. A setting that has a
 * default (the assistant's `voice`) may be left out: reading the row fills it
 * in, exactly as it does for rows saved before that setting existed.
 */
export type SchoolFeatureConfigInput<K extends SchoolFeatureKey> = z.input<
  (typeof schoolFeatureCatalogue)[K]["config"]
>;

/**
 * One feature's state for one school, as separate facts:
 * - `included`: the school's tier includes the feature (the catalogue's
 *   `tiers`);
 * - `adjustment`: what an administrator set for this one school on top of
 *   its tier: `true` (on), `false` (off), or null when the school follows
 *   its tier. This is what an update writes;
 * - `enabled`: the feature's switch, the adjustment when there is one and
 *   otherwise `included`;
 * - `active`: whether the school **has** the feature now: its switch is on
 *   and every feature it `requires` is active. Every gate, screen and tool
 *   list decides from this, never from `enabled`;
 * - `config`: null when nothing is stored (or the feature has no settings);
 *   it is kept while the feature is disabled.
 */
export type SchoolFeatureState<K extends SchoolFeatureKey> = {
  included: boolean;
  adjustment: boolean | null;
  enabled: boolean;
  active: boolean;
  config: SchoolFeatureConfig<K> | null;
};

/** Every feature's state for one school, keyed by feature. */
export type SchoolFeatureFlags = {
  [K in SchoolFeatureKey]: SchoolFeatureState<K>;
};



/**
 * One feature's stored state **with its key**, as a union discriminated on
 * `feature`: `{ feature: 'cadet'; config: CadetConfig } | { feature:
 * 'notices'; config: NoticesConfig }`. This is the type to use whenever the
 * key is not a literal (a loop over `SCHOOL_FEATURE_KEYS`, an admin form):
 * a value whose `feature` is the whole key union cannot carry one feature's
 * config for another, because each member pairs a key with its own config.
 * `SchoolFeatureState<K>` alone cannot give that guarantee once `K` widens
 * to the union.
 *
 * `enabled` here is the school's **adjustment** as it is written: `true` or
 * `false` to set the feature for this school whatever its tier, null to
 * follow the tier.
 *
 * Generic over the catalogue so the guarantee is testable against a
 * catalogue whose configs differ (`catalogue.test.ts`); application code uses
 * `SchoolFeatureEntry`.
 */
export type FeatureEntryIn<C extends FeatureCatalogueShape> = {
  [K in keyof C]: {
    feature: K;
    enabled: boolean | null;
    config: z.infer<C[K]["config"]> | null;
  };
}[keyof C];

/** One catalogue feature's keyed state (see `FeatureEntryIn`). */
export type SchoolFeatureEntry = FeatureEntryIn<typeof schoolFeatureCatalogue>;

/**
 * A school's flags as keyed entries, in catalogue order. Each entry keeps
 * its key and its own config together, so callers iterate without casting.
 * An entry carries what is stored (the adjustment and the config), so
 * writing it back unchanged changes nothing: a feature that follows its
 * tier keeps following it.
 */
export function schoolFeatureEntries(
  flags: SchoolFeatureFlags,
): SchoolFeatureEntry[] {
  // The adjustment and config only: `included`, `enabled` and `active` are derived and never written back.
  return SCHOOL_FEATURE_KEYS.map(
    (feature) =>
      ({
        feature,
        enabled: flags[feature].adjustment,
        config: flags[feature].config,
      }) as SchoolFeatureEntry,
  );
}

/** A feature that no tier gives the school, with no adjustment and nothing stored: off and inactive. */
export const DISABLED_SCHOOL_FEATURE = {
  included: false,
  adjustment: null,
  enabled: false,
  active: false,
  config: null,
} as const;

/**
 * Whether a tier includes a feature (the catalogue's `tiers`). A null tier
 * (no subscribed tier) includes none.
 */
export function schoolTierIncludes(tier: SchoolTier | null, key: SchoolFeatureKey): boolean {
  if (tier === null) return false;
  const tiers: readonly SchoolTier[] = schoolFeatureCatalogue[key].tiers;
  return tiers.includes(tier);
}

/** The features a tier includes, in catalogue order. */
export function schoolTierFeatures(tier: SchoolTier): SchoolFeatureKey[] {
  return SCHOOL_FEATURE_KEYS.filter((key) => schoolTierIncludes(tier, key));
}

/**
 * Every feature's switch for a school on `tier` with the given adjustments:
 * the adjustment where one is stored, otherwise whether the tier includes
 * the feature. The one implementation, used by the store's reads and by the
 * admin app to say what a tier change would do. A null `tier` (no subscribed
 * tier) includes no feature, so only the school's adjustments switch any on.
 */
export function resolveSchoolFeatureSwitches(
  tier: SchoolTier | null,
  adjustments: Partial<Record<SchoolFeatureKey, boolean | null>>,
): Record<SchoolFeatureKey, boolean> {
  return Object.fromEntries(
    SCHOOL_FEATURE_KEYS.map((key) => [
      key,
      adjustments[key] ?? schoolTierIncludes(tier, key),
    ]),
  ) as Record<SchoolFeatureKey, boolean>;
}

/**
 * Every feature's `active` fact from the switches alone: a feature is active
 * while its switch is on and every feature it `requires` is active. The one
 * implementation, used by the store's reads and the gate.
 */
export function resolveSchoolFeatureActivity(
  switches: Record<SchoolFeatureKey, boolean>,
): Record<SchoolFeatureKey, boolean> {
  const active = {} as Record<SchoolFeatureKey, boolean>;
  const visit = (key: SchoolFeatureKey, path: readonly SchoolFeatureKey[]): boolean => {
    if (key in active) return active[key];
    if (path.includes(key)) throw new Error(`Feature requirements form a cycle: ${[...path, key].join(" -> ")}.`);
    const required: readonly SchoolFeatureKey[] = schoolFeatureCatalogue[key].requires;
    const result = switches[key] && required.every((other) => visit(other, [...path, key]));
    active[key] = result;
    return result;
  };
  for (const key of SCHOOL_FEATURE_KEYS) visit(key, []);
  return active;
}

/** The features `key` requires that are not active (empty when it may be active). */
export function missingSchoolFeatureRequirements(
  key: SchoolFeatureKey,
  flags: Pick<SchoolFeatureFlags, SchoolFeatureKey>,
): SchoolFeatureKey[] {
  const required: readonly SchoolFeatureKey[] = schoolFeatureCatalogue[key].requires;
  return required.filter((other) => !flags[other].active);
}

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
  included: z.ZodBoolean;
  adjustment: z.ZodNullable<z.ZodBoolean>;
  enabled: z.ZodBoolean;
  active: z.ZodBoolean;
  config: z.ZodNullable<(typeof schoolFeatureCatalogue)[K]["config"]>;
}>;

/**
 * Zod schema of one feature's state, typed per key. The return type is
 * stated: inferred, TypeScript widens `schoolFeatureCatalogue[key]` to every
 * key's config, so one feature's state would accept another's settings.
 */
export function schoolFeatureStateSchema<K extends SchoolFeatureKey>(key: K): SchoolFeatureStateSchema<K> {
  return z.object({
    included: z.boolean(),
    adjustment: z.boolean().nullable(),
    enabled: z.boolean(),
    active: z.boolean(),
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
 * One feature's new stored state as a discriminated union on `feature`, so a
 * submitted config is validated against that feature's schema only.
 * `enabled` is the school's adjustment: on, off, or null to follow its tier.
 */
export const schoolFeatureUpdateSchema = z.discriminatedUnion(
  "feature",
  SCHOOL_FEATURE_KEYS.map((key) =>
    z.object({
      feature: z.literal(key),
      enabled: z.boolean().nullable(),
      config: schoolFeatureCatalogue[key].config.nullable(),
    }),
  ) as unknown as [
    SchoolFeatureUpdateOption<"studentManagement">,
    ...SchoolFeatureUpdateOption<SchoolFeatureKey>[],
  ],
);

type SchoolFeatureUpdateOption<K extends SchoolFeatureKey> = K extends unknown
  ? z.ZodObject<{
      feature: z.ZodLiteral<K>;
      enabled: z.ZodNullable<z.ZodBoolean>;
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

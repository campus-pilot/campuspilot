import type { SchoolFeatureKey } from '@campuspilot/db/feature-flags/catalogue';

import { assertSchoolFeatureEnabled } from '../feature-flags/feature-flags.service';
import { o } from '../index';

type SchoolScopedInput = {
  schoolId: string;
};

/**
 * The feature each middleware made by {@link requireSchoolFeature} gates.
 * oRPC keeps the very middleware object on the procedure
 * (`procedure['~orpc'].middlewares`), so the MCP catalog reads a tool's
 * features from the gate itself ({@link schoolFeatureGatesOf}) and the tool
 * lists can never disagree with what a call is refused for.
 */
const FEATURE_GATES = new WeakMap<object, SchoolFeatureKey>();

/**
 * Creates an input-aware oRPC middleware that refuses the procedure unless
 * the input school has `feature` (it is active: its switch and every feature
 * it requires; see the feature catalogue).
 *
 * A feature flag is not authorization: it says what the school has, not who
 * may act. Attach it after `.input(...)` and **after** the permission
 * middleware, so a caller without access to the school gets the ordinary
 * FORBIDDEN and cannot probe which features a school has:
 *
 *   .use(requireSchoolPermission(SCHOOL_ACTIONS.X))
 *   .use(requireSchoolFeature('notices'))
 *
 * A disabled feature throws FORBIDDEN with
 * `data: { reason: 'SCHOOL_FEATURE_DISABLED', feature }`.
 *
 * The gate decides from the feature being active alone, exactly like every
 * other enforcement point (`assertSchoolFeatureEnabled`). It does not read or
 * parse the feature's stored config and adds nothing to the context: a
 * config that no longer matches its schema must not turn every procedure of
 * the feature into a server error. A handler that uses the config reads it
 * itself with `getSchoolFeatureConfig(context.db, input.schoolId, feature)`,
 * which is the only call that can fail on it (CONFLICT,
 * `SCHOOL_FEATURE_CONFIG_INVALID`).
 */
export function requireSchoolFeature<TInput extends SchoolScopedInput = SchoolScopedInput>(feature: SchoolFeatureKey) {
  const middleware = o.middleware<Record<never, never>, TInput>(async ({ context, next }, input) => {
    // A gated procedure must name its school; without one there is nothing to decide from.
    if (typeof input?.schoolId !== 'string') {
      throw new TypeError(`A procedure gated on the ${feature} feature has no schoolId input.`);
    }
    await assertSchoolFeatureEnabled(context.db, input.schoolId, feature);
    return next();
  });
  FEATURE_GATES.set(middleware, feature);
  return middleware;
}

/** The features gated by {@link requireSchoolFeature} among a procedure's middlewares, in order, each once. */
export function schoolFeatureGatesOf(middlewares: readonly unknown[]): SchoolFeatureKey[] {
  const features: SchoolFeatureKey[] = [];
  for (const middleware of middlewares) {
    if (typeof middleware !== 'function' && (typeof middleware !== 'object' || middleware === null)) continue;
    const feature = FEATURE_GATES.get(middleware);
    if (feature && !features.includes(feature)) features.push(feature);
  }
  return features;
}

/** A finished procedure (`DecoratedProcedure`), which still accepts middleware. */
type GateableProcedure = { use(middleware: never): unknown };

/**
 * Gates every procedure of a router on one feature: each gets
 * {@link requireSchoolFeature} appended as its **last** middleware, so it
 * runs after the procedure's own permission checks (a caller without access
 * still learns nothing about the school's features) and after its input is
 * validated. For areas that belong wholly to a feature (admissions,
 * students, billing); a procedure that only partly does checks
 * `assertSchoolFeatureEnabled` itself.
 *
 * Every procedure's input must carry `schoolId`; the middleware refuses one
 * that does not, and the MCP catalog test checks it for every gated tool.
 */
export function gateRouterOnSchoolFeature<R extends Record<string, GateableProcedure>>(feature: SchoolFeatureKey, router: R): R {
  return Object.fromEntries(
    Object.entries(router).map(([name, procedure]) => [
      name,
      (procedure.use as (middleware: unknown) => unknown).call(procedure, requireSchoolFeature(feature)),
    ]),
  ) as R;
}

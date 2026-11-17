'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  resolveSchoolFeatureActivity,
  resolveSchoolFeatureSwitches,
  SCHOOL_FEATURE_KEYS,
  schoolFeatureCatalogue,
  type SchoolFeatureFlags,
  type SchoolFeatureKey,
  type SchoolTier,
} from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import type { adminSchoolFeatureFlagsDtoSchema } from '@campuspilot/api/routers/system-admin/feature-flags/feature-flags.dto';
import type { z } from 'zod';
import { orpc } from '@/lib/orpc';
import { DISABLE_WARNINGS } from './school-feature-warnings';

/** A school's plan and features as the admin editor reads them (`getSchoolFeatureFlags`). */
export type SchoolPlanFlags = z.infer<typeof adminSchoolFeatureFlagsDtoSchema>;

/**
 * What moving the school's plan to `planTier` (null: no plan) would do to
 * the features it has: the ones it would lose and the ones it would gain.
 * Decided with the catalogue's own rules (the school's adjustments are
 * kept across a plan change, and a feature also needs the features it
 * requires), so this says exactly what the server will do. Callers work out
 * the plan tier with `resolveSchoolPlan` from the standing tier and period the
 * change leaves.
 */
export function planChangeEffect(features: SchoolFeatureFlags, planTier: SchoolTier | null) {
  const adjustments = Object.fromEntries(
    SCHOOL_FEATURE_KEYS.map((key) => [key, features[key].adjustment]),
  ) as Record<SchoolFeatureKey, boolean | null>;
  const next = resolveSchoolFeatureActivity(resolveSchoolFeatureSwitches(planTier, adjustments));
  return {
    lost: SCHOOL_FEATURE_KEYS.filter((key) => features[key].active && !next[key]),
    gained: SCHOOL_FEATURE_KEYS.filter((key) => !features[key].active && next[key]),
  };
}

const featureNames = (keys: SchoolFeatureKey[]) => keys.map((key) => schoolFeatureCatalogue[key].label).join(', ');

/** Said under a pending plan change: what the school gains and loses. */
export function PlanChangeSummary({ features, planTier }: { features: SchoolFeatureFlags; planTier: SchoolTier | null }) {
  const { lost, gained } = planChangeEffect(features, planTier);
  if (lost.length === 0 && gained.length === 0) {
    return <p className="text-xs text-muted-foreground">The school keeps exactly the features it has now.</p>;
  }
  return (
    <div className="flex flex-col gap-1 text-xs">
      {gained.length > 0 ? <p className="text-muted-foreground">Adds: {featureNames(gained)}.</p> : null}
      {lost.length > 0 ? <p className="text-destructive">Switches off: {featureNames(lost)}.</p> : null}
    </div>
  );
}

/** The features a plan change takes away, each with everything that stops with it. */
export function LostFeatureWarnings({ lost }: { lost: SchoolFeatureKey[] }) {
  if (lost.length === 0) return null;
  return (
    <ul className="flex max-h-72 flex-col gap-3 overflow-y-auto text-xs">
      {lost.map((feature) => (
        <li key={feature} className="flex flex-col gap-1">
          <span className="font-medium">{schoolFeatureCatalogue[feature].label}</span>
          <span className="text-muted-foreground">{DISABLE_WARNINGS[feature]}</span>
        </li>
      ))}
    </ul>
  );
}

/** What a school without a plan means for its people, said wherever a change can leave it there. */
export const NO_PLAN_CONSEQUENCE =
  'It will be blocked: its staff can still sign in, but nothing can be changed and every feature of a plan is off (student records, notices, the Cadet Portal) until it gets a subscription or a trial. Nothing is deleted.';

/**
 * Reads everything that shows a school's plan again after a change: the
 * plan and features, the school (badges, Settings), the school lists and
 * the trial history.
 */
export function useRefreshSchoolPlan(schoolId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.getSchoolFeatureFlags.queryKey({ input: { id: schoolId } }) });
    void queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.getSchool.queryKey({ input: { id: schoolId } }) });
    void queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listSchools.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.getSchoolBilling.queryKey({ input: { id: schoolId } }) });
  };
}

/** The message of a failed save, for the form's error line. */
export function saveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** The text of one form-level error as TanStack Form holds it. */
export function formErrorText(error: unknown): string {
  return typeof error === 'object' && error !== null && 'form' in error ? String(error.form) : String(error);
}

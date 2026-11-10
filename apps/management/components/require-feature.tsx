'use client';

import type { ReactNode } from 'react';
import type { SchoolFeatureKey } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import { useQuery } from '@tanstack/react-query';
import { orpc } from '@/lib/orpc';
import { resolveSchoolFeature, type SchoolFeatureView } from './require-feature-model';

/**
 * One feature's state for a school, typed by its key (`config` is that
 * feature's config type only). Every caller for the same school shares one
 * query (`school.getFeatureFlags`), so gating many items costs one request.
 * While the flags load, and if loading fails, the feature reads as disabled.
 *
 * Feature flags say what the school has; they are not permissions. Gate a
 * permission-protected entry point with both `RequireFeature` and
 * `RequirePermissions`. The server enforces the flag again on every call.
 */
export function useSchoolFeature<K extends SchoolFeatureKey>(
  schoolId: string,
  feature: K,
): SchoolFeatureView<K> {
  const flagsQuery = useQuery(
    orpc.school.getFeatureFlags.queryOptions({ input: { schoolId } }),
  );
  return resolveSchoolFeature(
    {
      isPending: flagsQuery.isPending,
      isError: flagsQuery.isError,
      features: flagsQuery.data?.features,
    },
    feature,
  );
}

export type RequireFeatureProps = {
  children: ReactNode;
  schoolId: string;
  feature: SchoolFeatureKey;
  fallback?: ReactNode;
};

/**
 * Renders children only when the school has the feature enabled. Pending,
 * failed and disabled all render `fallback` (default: nothing), so gated
 * navigation and actions never flash before the flags are known.
 */
export function RequireFeature({
  children,
  schoolId,
  feature,
  fallback = null,
}: RequireFeatureProps) {
  const { enabled } = useSchoolFeature(schoolId, feature);
  if (!enabled) return fallback;

  return children;
}

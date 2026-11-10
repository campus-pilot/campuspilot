'use client';

import type { ReactNode } from 'react';
import type { SchoolFeatureKey } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import { useQuery } from '@tanstack/react-query';
import { orpc } from '@/lib/orpc';
import { resolveSchoolFeature, type SchoolFeatureView } from './require-feature-model';

/**
 * One feature's state for a school, typed by its key (`config` is that
 * feature's config type only), with `retry` to read the flags again. Every
 * caller for the same school shares one query (`school.getFeatureFlags`), so
 * gating many items costs one request.
 *
 * `status` tells three outcomes apart (see `SchoolFeatureView`): the flags
 * are known (`ready`, enabled or not), still loading (`pending`), or could
 * not be read (`unknown`). `enabled` is false for the last two, so a plain
 * `enabled` check fails closed; a screen that must not mistake "could not
 * load" for "not enabled" reads `status`.
 *
 * Feature flags say what the school has; they are not permissions. Gate a
 * permission-protected entry point with both `RequireFeature` and
 * `RequirePermissions`. The server enforces the flag again on every call.
 */
export function useSchoolFeature<K extends SchoolFeatureKey>(
  schoolId: string,
  feature: K,
): SchoolFeatureView<K> & { retry: () => void } {
  const flagsQuery = useQuery(
    orpc.school.getFeatureFlags.queryOptions({ input: { schoolId } }),
  );
  const view = resolveSchoolFeature(
    {
      isPending: flagsQuery.isPending,
      isError: flagsQuery.isError,
      features: flagsQuery.data?.features,
    },
    feature,
  );
  return { ...view, retry: () => void flagsQuery.refetch() };
}

export type RequireFeatureProps = {
  children: ReactNode;
  schoolId: string;
  feature: SchoolFeatureKey;
  fallback?: ReactNode;
};

/**
 * Renders children only when the school is known to have the feature.
 * Loading, unknown (the flags could not be read) and disabled all render
 * `fallback` (default: nothing), so gated navigation and actions never flash
 * before the flags are known. A failed background refetch does not hide
 * anything: the flags already known keep applying.
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

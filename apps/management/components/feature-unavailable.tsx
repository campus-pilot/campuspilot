'use client';

import type { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { PackageX, WifiOff } from 'lucide-react';
import {
  schoolFeatureCatalogue,
  type SchoolFeatureKey,
} from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import { Button } from '@campuspilot/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@campuspilot/ui/components/empty';
import { useSchoolFeature } from './require-feature';

/** Shown in place of a page whose feature the school does not have. */
export function FeatureUnavailable({ feature }: { feature: SchoolFeatureKey }) {
  const { label } = schoolFeatureCatalogue[feature];
  return (
    <Empty className="mx-auto w-full max-w-3xl border border-dashed p-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PackageX />
        </EmptyMedia>
        <EmptyTitle>{label} is not enabled</EmptyTitle>
        <EmptyDescription>
          {label} is not part of this school&apos;s CampusPilot setup. Contact CampusPilot support to enable it.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * Shown in place of a page when the school's features could not be read.
 * It says so and offers a retry; it does not claim the feature is missing,
 * which only a successful read can tell.
 */
export function FeatureUnknown({ feature, onRetry }: { feature: SchoolFeatureKey; onRetry: () => void }) {
  const { label } = schoolFeatureCatalogue[feature];
  return (
    <Empty className="mx-auto w-full max-w-3xl border border-dashed p-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WifiOff />
        </EmptyMedia>
        <EmptyTitle>Could not open {label}</EmptyTitle>
        <EmptyDescription>
          We could not check this school&apos;s CampusPilot setup. Check your connection and try again.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/**
 * Gates a whole page of a school route on a feature. The navigation already
 * hides the link (`RequireFeature`); this covers a typed or bookmarked URL.
 * Three outcomes, each shown as what it is: the page when the feature is
 * enabled, "not enabled" when the school is known not to have it, and a
 * retry when the flags could not be read. Nothing is drawn while the first
 * read runs, so neither the page nor a message flashes.
 *
 * A page that is open stays open through a failed background refetch (the
 * known flags keep applying), so unsaved input is not unmounted by a
 * network blip.
 */
export function FeaturePage({ feature, children }: { feature: SchoolFeatureKey; children: ReactNode }) {
  const schoolId = String(useParams().schoolId ?? '');
  const state = useSchoolFeature(schoolId, feature);
  if (state.enabled) return children;
  if (state.status === 'pending') return null;
  if (state.status === 'unknown') return <FeatureUnknown feature={feature} onRetry={state.retry} />;
  return <FeatureUnavailable feature={feature} />;
}

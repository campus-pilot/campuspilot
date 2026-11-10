'use client';

import type { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { PackageX } from 'lucide-react';
import {
  schoolFeatureCatalogue,
  type SchoolFeatureKey,
} from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import {
  Empty,
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
 * Gates a whole page of a school route on a feature. The navigation already
 * hides the link (`RequireFeature`); this covers a typed or bookmarked URL.
 * Nothing is drawn while the flags load, so neither the page nor the
 * "not enabled" message flashes; a failed load reads as not enabled
 * (fail closed).
 */
export function FeaturePage({ feature, children }: { feature: SchoolFeatureKey; children: ReactNode }) {
  const schoolId = String(useParams().schoolId ?? '');
  const state = useSchoolFeature(schoolId, feature);
  if (state.enabled) return children;
  if (state.status === 'pending') return null;
  return <FeatureUnavailable feature={feature} />;
}

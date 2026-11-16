import type { ReactNode } from 'react';
import { FeaturePage } from '@/components/feature-unavailable';

/**
 * Everything under this route belongs to student management (admit card templates): a
 * school without it sees "not enabled" here, also for a typed or bookmarked URL.
 */
export default function AdmitCardTemplateFeatureLayout({ children }: { children: ReactNode }) {
  return <FeaturePage feature="studentManagement">{children}</FeaturePage>;
}

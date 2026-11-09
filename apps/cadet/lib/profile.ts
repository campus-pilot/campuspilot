import type { CadetProfileDto } from '@campuspilot/api/routers/cadet/cadet.dto';

export type CadetCurrentClass = NonNullable<CadetProfileDto['current']>;

/**
 * The class record the server treats as current (the same default listExams
 * and getGrowth use), so the top bar, Home and Fees never disagree with the
 * Results and Growth screens. Null for a student without a class.
 */
export function currentEnrollment(profile: CadetProfileDto): CadetCurrentClass | null {
  return profile.current;
}

/** "Class 7 B · 2026–27", or just the session while the class is unknown. */
export function enrollmentLabel(current: CadetCurrentClass | null) {
  if (!current) return null;
  const placement = [current.classLabel, current.sectionLabel].filter(Boolean).join(' ');
  return placement ? `${placement} · ${current.sessionLabel}` : current.sessionLabel;
}

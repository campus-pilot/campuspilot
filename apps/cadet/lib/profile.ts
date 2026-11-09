import type { CadetProfileDto } from '@campuspilot/api/routers/cadet/cadet.dto';

export type CadetEnrollment = CadetProfileDto['enrollments'][number];

/**
 * The enrollment shown as "current": the one in the school's active session
 * (its own flag, not a date guess), else the newest. Null for a student
 * without any enrollment yet.
 */
export function currentEnrollment(profile: CadetProfileDto): CadetEnrollment | null {
  return profile.enrollments.find((row) => row.sessionIsActive) ?? profile.enrollments[0] ?? null;
}

/** "Class 7 B · 2026–27", or just the session while the class is unknown. */
export function enrollmentLabel(enrollment: CadetEnrollment | null) {
  if (!enrollment) return null;
  const placement = [enrollment.classLabel, enrollment.sectionLabel].filter(Boolean).join(' ');
  return placement ? `${placement} · ${enrollment.sessionLabel}` : enrollment.sessionLabel;
}

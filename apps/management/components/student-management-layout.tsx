import type { ReactNode } from 'react';
import { FeaturePage } from './feature-unavailable';

/**
 * The layout of every route that belongs wholly to student management
 * (admissions, a classroom's students and documents, generated documents, an
 * examination's classes and timetable, admission document settings and the
 * student and finance templates): a school without it sees "not enabled"
 * there, also for a typed or bookmarked URL. Each such route's `layout.tsx`
 * re-exports this as its default, so the gate is stated once.
 */
export default function StudentManagementLayout({ children }: { children: ReactNode }) {
  return <FeaturePage feature="studentManagement">{children}</FeaturePage>;
}

'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AuthLoading } from '@/components/auth-loading';
import { RouteAfterCommit } from '@/components/school-selection';
import { orpc } from '@/lib/orpc';
import { personalPapersHref } from './personal-space-model';

/** The kind of one of the user's schools, from the cached school list; undefined while it loads or when it is not theirs. */
function useSchoolKind(schoolId: string) {
  const schoolsQuery = useQuery(orpc.school.listMySchools.queryOptions());
  return { kind: schoolsQuery.data?.find((school) => school.id === schoolId)?.kind, isPending: schoolsQuery.isPending };
}

/**
 * Wraps every page of a real school (the workspace, settings, the guided
 * setup): a personal space has none of them (docs/personal-space.md), so its
 * address there opens its papers instead. Decided from the school's `kind`,
 * before the pages mount, so none of them asks the server for what a personal
 * space does not have.
 */
export function RealSchoolOnly({ schoolId, children }: { schoolId: string; children: ReactNode }) {
  const { kind, isPending } = useSchoolKind(schoolId);
  if (isPending) return <AuthLoading label="Opening your school…" />;
  if (kind === 'personal') return <RouteAfterCommit href={personalPapersHref(schoolId)} schoolId={schoolId} />;
  return children;
}

/**
 * Renders its children only in a real school: what a personal space must not
 * have on any of its pages (the assistant's voice overlay, D4). Nothing while
 * the kind is unknown.
 */
export function OnlyInRealSchool({ schoolId, children }: { schoolId: string; children: ReactNode }) {
  const { kind } = useSchoolKind(schoolId);
  return kind === 'school' ? children : null;
}

'use client';

import { Alert, AlertDescription, AlertTitle } from '@campuspilot/ui/components/reui/alert';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlertIcon } from 'lucide-react';

import { orpc } from '@/lib/orpc';
import { CADET_SCHOOL_SUSPENDED_MESSAGE } from '@/lib/school-suspension';

/**
 * Permanent notice at the top of every signed-in page while the student's
 * school is suspended (`getSchool().isSuspended`, docs/school-suspension.md).
 * The portal is then read-only: every screen still shows its records, and
 * the few things a student can change (device notifications, read marks)
 * are refused by the server.
 *
 * It reads the school with a one-minute freshness of its own (the install
 * chrome keeps the same answer for an hour), so a suspension, or its end,
 * shows when the student comes back to the portal. A refused change reads
 * it again at once (`createQueryClient`). Nothing is shown while the school
 * is not known: no notice is better than a wrong one.
 */
export function SuspendedSchoolNotice() {
  const school = useQuery(orpc.getSchool.queryOptions({ staleTime: 60 * 1_000 }));
  if (!school.data?.isSuspended) return null;
  return (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertTitle>School suspended</AlertTitle>
      <AlertDescription>{CADET_SCHOOL_SUSPENDED_MESSAGE}</AlertDescription>
    </Alert>
  );
}

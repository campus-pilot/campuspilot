'use client';

import { Alert, AlertDescription, AlertTitle } from '@campuspilot/ui/components/reui/alert';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlertIcon } from 'lucide-react';

import { orpc } from '@/lib/orpc';
import { CADET_READ_ONLY_SCHOOL_NOTICES, readOnlySchoolReason } from '@/lib/read-only-school';

/**
 * Permanent notice at the top of every signed-in page while the student's
 * school is read-only: suspended (`getSchool().isSuspended`,
 * docs/school-suspension.md) or without an active plan
 * (`getSchool().hasActivePlan`, docs/school-trials.md). Every screen still
 * shows its records, and the few things a student can change (device
 * notifications, read marks) are refused by the server.
 *
 * It reads the school with a one-minute freshness of its own (the install
 * chrome keeps the same answer for an hour), so a suspension or an ended
 * plan, or its end, shows when the student comes back to the portal. A
 * refused change reads it again at once (`createQueryClient`). Nothing is
 * shown while the school is not known: no notice is better than a wrong one.
 */
export function ReadOnlySchoolNotice() {
  const school = useQuery(orpc.getSchool.queryOptions({ staleTime: 60 * 1_000 }));
  const reason = school.data ? readOnlySchoolReason(school.data) : null;
  if (reason === null) return null;
  const notice = CADET_READ_ONLY_SCHOOL_NOTICES[reason];
  return (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription>{notice.message}</AlertDescription>
    </Alert>
  );
}

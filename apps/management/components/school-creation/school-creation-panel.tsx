'use client';

import { useQuery } from '@tanstack/react-query';
import type { SchoolCreationStatusDto } from '@campuspilot/api/routers/school-creation/school-creation.dto';
import { SCHOOL_CREATION_REFUSAL_MESSAGES } from '@campuspilot/api/school-creation/school-creation.contract';
import { Alert, AlertDescription, AlertTitle } from '@campuspilot/ui/components/alert';
import { Button } from '@campuspilot/ui/components/button';
import { Clock3, Info } from 'lucide-react';
import { orpc } from '@/lib/orpc';
import { CreateSchoolDialog } from './create-school-form';
import { RequestMoreSchoolsDialog } from './request-more-schools-form';

const dateFormatter = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' });

type LatestRequest = NonNullable<SchoolCreationStatusDto['latestRequest']>;

function PendingRequestNotice({ request }: { request: LatestRequest }) {
  return (
    <Alert className="text-left">
      <Clock3 aria-hidden />
      <AlertTitle>Request sent</AlertTitle>
      <AlertDescription>
        You asked on {dateFormatter.format(request.createdAt)} to create up to {request.requestedLimit} schools.
        CampusPilot will review it and you can create another school here once it is approved.
      </AlertDescription>
    </Alert>
  );
}

function RejectedRequestNotice({ request }: { request: LatestRequest }) {
  return (
    <Alert className="text-left">
      <Info aria-hidden />
      <AlertTitle>Your last request was not approved</AlertTitle>
      <AlertDescription>{request.decisionNote ?? 'You can send a new request with more detail.'}</AlertDescription>
    </Alert>
  );
}

/** The note CampusPilot wrote when approving the person's latest request, or null without one. */
export function approvalNoteOf(status: SchoolCreationStatusDto): string | null {
  const request = status.latestRequest;
  return request?.status === 'approved' ? request.decisionNote : null;
}

function ApprovedRequestNotice({ note }: { note: string }) {
  return (
    <Alert className="text-left">
      <Info aria-hidden />
      <AlertTitle>Your request was approved</AlertTitle>
      <AlertDescription>{note}</AlertDescription>
    </Alert>
  );
}

/** The person used their allowance: their request's state, and the button to ask again when nothing is pending. */
function LimitReached({ status }: { status: SchoolCreationStatusDto }) {
  const request = status.latestRequest;
  if (request?.status === 'pending') return <PendingRequestNotice request={request} />;
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-muted-foreground">
        You have created {status.used} of the {status.limit} school{status.limit === 1 ? '' : 's'} your account
        allows, counting schools that were deleted or handed over.
      </p>
      {request?.status === 'rejected' ? <RejectedRequestNotice request={request} /> : null}
      <RequestMoreSchoolsDialog currentLimit={status.limit} />
    </div>
  );
}

function StatusBody({ status }: { status: SchoolCreationStatusDto }) {
  if (status.refusal === null) {
    const note = approvalNoteOf(status);
    return (
      <div className="flex flex-col items-center gap-4">
        {note ? <ApprovedRequestNotice note={note} /> : null}
        <CreateSchoolDialog />
      </div>
    );
  }
  if (status.refusal === 'limit_reached') return <LimitReached status={status} />;
  return (
    <Alert className="text-left">
      <Info aria-hidden />
      <AlertDescription>{SCHOOL_CREATION_REFUSAL_MESSAGES[status.refusal]}</AlertDescription>
    </Alert>
  );
}

/**
 * Self-service school creation (docs/school-creation.md), decided by the
 * server's status: the Create a school button (its form opens in a dialog)
 * while the person may create a school, the button to ask for more once their
 * allowance is used, and the reason otherwise (staff of another school, a
 * demo account, an unverified email).
 */
export function SchoolCreationPanel() {
  const statusQuery = useQuery(orpc.schoolCreation.getStatus.queryOptions());
  if (statusQuery.isPending) {
    return <div className="mx-auto h-9 w-40 animate-pulse rounded-md bg-muted" />;
  }
  if (!statusQuery.data) {
    return (
      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-destructive">Unable to check whether you can create a school.</p>
        <Button type="button" variant="outline" onClick={() => void statusQuery.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return <StatusBody status={statusQuery.data} />;
}

/** Whether the switcher should offer creating a school: only to people who may create one or may ask for more. */
export function useOffersSchoolCreation() {
  const statusQuery = useQuery(orpc.schoolCreation.getStatus.queryOptions());
  const refusal = statusQuery.data?.refusal;
  return statusQuery.data !== undefined && (refusal === null || refusal === 'limit_reached');
}

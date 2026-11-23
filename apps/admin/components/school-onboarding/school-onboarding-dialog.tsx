'use client';

import { useQuery } from '@tanstack/react-query';
import type { SchoolRegistrationRequestDto } from '@campuspilot/api/routers/system-admin/school-registration-request/school-registration-request.dto';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import Link from 'next/link';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { orpc } from '@/lib/orpc';
import { classAnswers, formatBytes, formatDuration, textAnswer, voiceNoteSeconds } from './onboarding-answers';

const dateTimeFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap break-words">{value ?? '—'}</dd>
    </div>
  );
}

function ClassesTable({ request }: { request: SchoolRegistrationRequestDto }) {
  const classes = classAnswers(request);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Classes ({classes.length})</h3>
      <dl className="divide-y rounded-lg border px-3">
        {classes.map((schoolClass) => (
          <div key={schoolClass.name} className="flex flex-col gap-1 py-2 text-sm">
            <dt className="font-medium">{schoolClass.name}</dt>
            <dd className="text-muted-foreground">Sections: {schoolClass.sections.join(', ') || '—'}</dd>
            <dd className="text-muted-foreground">Subjects: {schoolClass.subjects.join(', ') || '—'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The request's logo and voice note, through short-lived presigned URLs
 * fetched when the dialog opens. They expire after a few minutes, so they
 * are never cached past that.
 */
function Media({ request }: { request: SchoolRegistrationRequestDto }) {
  const { data, isPending, isError } = useQuery({
    ...orpc.systemAdmin.getSchoolRegistrationRequestMedia.queryOptions({ input: { requestId: request.id } }),
    enabled: request.logo !== null || request.voiceNote !== null,
    staleTime: 60_000,
    gcTime: 60_000,
  });
  const seconds = voiceNoteSeconds(request);
  if (!request.logo && !request.voiceNote) return <p className="text-sm text-muted-foreground">No logo or voice note.</p>;
  if (isError) return <p className="text-sm text-destructive">The files could not be loaded.</p>;
  if (isPending) return <Skeleton className="h-16 w-full" />;
  return (
    <div className="flex flex-col gap-3">
      {request.logo && data.logoUrl ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived presigned URL, not a static asset */}
          <img src={data.logoUrl} alt="School logo" className="size-16 rounded-lg border object-contain" />
          <span className="text-xs text-muted-foreground">Logo · {formatBytes(request.logo.bytes)}</span>
        </div>
      ) : null}
      {request.voiceNote && data.voiceNoteUrl ? (
        <div className="flex flex-col gap-1">
          <audio controls preload="metadata" src={data.voiceNoteUrl} className="w-full" />
          <span className="text-xs text-muted-foreground">
            Voice note{seconds ? ` · ${formatDuration(seconds)}` : ''} · {formatBytes(request.voiceNote.bytes)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Details({ request }: { request: SchoolRegistrationRequestDto }) {
  return (
    <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
      <Media request={request} />
      <dl className="divide-y">
        <Row label="Phone" value={textAnswer(request, 'phone')} />
        <Row label="Email" value={textAnswer(request, 'email')} />
        <Row label="Address" value={textAnswer(request, 'address')} />
        <Row label="Notes" value={textAnswer(request, 'notes')} />
      </dl>
      <ClassesTable request={request} />
      <p className="text-xs text-muted-foreground">
        Form v{request.formVersion} · {request.sourcePath ?? 'unknown page'} · {request.id}
      </p>
    </div>
  );
}

/**
 * Where setting this school up stands, as the dialog's main action: start it,
 * continue a saved draft or a failed run, follow a running one, or open the
 * school it created.
 */
function SetupAction({ request }: { request: SchoolRegistrationRequestDto }) {
  const href = `/school-onboarding/${request.id}/setup`;
  const setup = request.setup;
  if (setup?.status === 'succeeded' && setup.schoolId) {
    return (
      <Button asChild variant="outline">
        <Link href={`/school/${setup.schoolId}`}>Open the school</Link>
      </Button>
    );
  }
  const label = !setup ? 'Start onboarding' : setup.status === 'draft' ? 'Continue onboarding' : setup.status === 'failed' ? 'Review the failed setup' : 'View setup progress';
  return (
    <Button asChild>
      <Link href={href}>{label}</Link>
    </Button>
  );
}

/** One School Onboarding submission: its files, answers and classes. */
export function SchoolOnboardingDialog({ request, onClose }: { request: SchoolRegistrationRequestDto | null; onClose: () => void }) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{request ? (textAnswer(request, 'schoolName') ?? 'School') : 'School'}</DialogTitle>
          <DialogDescription>{request ? `Received ${dateTimeFormatter.format(request.createdAt)}` : null}</DialogDescription>
        </DialogHeader>
        {request ? <Details request={request} /> : null}
        {request ? (
          <DialogFooter>
            <SetupAction request={request} />
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

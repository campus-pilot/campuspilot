'use client';

import { Button } from '@campuspilot/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import { useMutation } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';

/** The three values a student types to sign in to the Cadet Portal. */
export type IssuedCadetPasswordDetails = {
  schoolSlug: string;
  admissionNo: string;
  password: string;
};

function detailsText(details: IssuedCadetPasswordDetails) {
  return [
    `School code: ${details.schoolSlug}`,
    `Admission number: ${details.admissionNo}`,
    `Password: ${details.password}`,
  ].join('\n');
}

/**
 * Copies all three sign-in details on a user action. The mutation remembers
 * the text it copied, so a different password is never shown as copied.
 *
 * Uses TanStack Query's `useMutation`, so it must render inside a
 * `QueryClientProvider` (see {@link IssuedCadetPasswordDialog}).
 */
function useCopyDetails(details: IssuedCadetPasswordDetails) {
  const text = detailsText(details);
  const copy = useMutation({
    mutationFn: async (value: string) => {
      await navigator.clipboard.writeText(value);
      return value;
    },
  });
  return { copy, text, copied: copy.isSuccess && copy.data === text };
}

/**
 * The dialog's footer actions. A clipboard failure is shown above the footer
 * row rather than under the Copy button, so its message never widens the
 * button.
 */
function IssuedPasswordActions({ details, onClose }: { details: IssuedCadetPasswordDetails; onClose: () => void }) {
  const { copy, text, copied } = useCopyDetails(details);
  return (
    <>
      {copy.isError ? <p className="text-xs text-destructive">Clipboard access is unavailable. Write the details down instead.</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={copy.isPending} onClick={() => copy.mutate(text)}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? 'Copied' : 'Copy details'}
        </Button>
        <Button type="button" onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  );
}

function DetailRow({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={emphasis ? 'font-mono text-base font-semibold' : 'font-mono text-sm'}>{value}</dd>
    </div>
  );
}

/**
 * Shows a newly issued Cadet Portal password exactly once, with the school
 * code and admission number the student signs in with. The password cannot
 * be viewed again after this dialog closes; staff can only issue a new one.
 *
 * Requires a TanStack Query `QueryClientProvider` above it in every consumer:
 * the copy button keeps its clipboard state in a `useMutation`. No query or
 * API call is made through that client.
 */
export function IssuedCadetPasswordDialog({
  details,
  studentName,
  onClose,
}: {
  /** The issued details; the dialog is open while this is set. */
  details: IssuedCadetPasswordDetails | null;
  studentName: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={details !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>This password will only be shown once</DialogTitle>
          <DialogDescription>
            Share these Cadet Portal sign-in details with {studentName}. Once you close this
            dialog the password cannot be viewed again; you can only issue a new one.
          </DialogDescription>
        </DialogHeader>
        {details ? (
          <dl className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
            <DetailRow label="School code" value={details.schoolSlug} />
            <DetailRow label="Admission number" value={details.admissionNo} />
            <DetailRow label="Password" value={details.password} emphasis />
          </dl>
        ) : null}
        {details ? (
          <IssuedPasswordActions details={details} onClose={onClose} />
        ) : (
          <DialogFooter>
            <Button type="button" onClick={onClose}>Done</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

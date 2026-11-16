'use client';

import { formatPhoneNumberForDisplay } from '@campuspilot/db/phone';
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

import type { StaffSignInIdentity } from './staff-sign-in-label';

/** A newly issued staff password and what the person signs in with. */
export type IssuedStaffPasswordDetails = StaffSignInIdentity & {
  name: string;
  password: string;
};

/** Sign-in rows in the order a person tries them: phone, email, password. */
function detailRows(details: IssuedStaffPasswordDetails) {
  return [
    details.phoneNumber
      ? { label: 'Phone number', value: formatPhoneNumberForDisplay(details.phoneNumber) }
      : null,
    details.email ? { label: 'Email', value: details.email } : null,
    { label: 'Password', value: details.password, emphasis: true },
  ].filter((row) => row !== null);
}

/**
 * Copies the sign-in details on a user action. The mutation remembers the
 * text it copied, so a different password is never shown as copied. Needs a
 * `QueryClientProvider` above the dialog (no API call is made).
 */
function useCopyDetails(details: IssuedStaffPasswordDetails) {
  const text = detailRows(details)
    .map(({ label, value }) => `${label}: ${value}`)
    .join('\n');
  const copy = useMutation({
    mutationFn: async (value: string) => {
      await navigator.clipboard.writeText(value);
      return value;
    },
  });
  return { copy, text, copied: copy.isSuccess && copy.data === text };
}

function IssuedPasswordActions({ details, onClose }: { details: IssuedStaffPasswordDetails; onClose: () => void }) {
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

function DetailList({ details }: { details: IssuedStaffPasswordDetails }) {
  return (
    <dl className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
      {detailRows(details).map(({ label, value, emphasis }) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className={emphasis ? 'font-mono text-base font-semibold' : 'font-mono text-sm'}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Shows a newly issued CampusPilot staff password exactly once, with the
 * phone number and email the person signs in with (both share the
 * password). It cannot be viewed again after closing; staff can only issue a
 * new one. Requires a TanStack Query `QueryClientProvider` above it.
 */
export function IssuedStaffPasswordDialog({
  details,
  onClose,
}: {
  /** The issued details; the dialog is open while this is set. */
  details: IssuedStaffPasswordDetails | null;
  onClose: () => void;
}) {
  const person = details?.name.trim() || 'this person';
  return (
    <Dialog open={details !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>This password will only be shown once</DialogTitle>
          <DialogDescription>
            Share these CampusPilot sign-in details with {person}. Once you close this dialog the
            password cannot be viewed again; you can only issue a new one.
          </DialogDescription>
        </DialogHeader>
        {details ? <DetailList details={details} /> : null}
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

'use client';

import type { ComponentProps, ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@campuspilot/ui/components/alert-dialog';
import { Button } from '@campuspilot/ui/components/button';

/** App-owned confirmation for destructive edits and navigation; dismissal cancels. */
export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  onOpenChange,
  onConfirm,
  pending = false,
  confirmVariant = 'destructive',
  confirmDisabled = false,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  /** The caller owns submission state; pending operations cannot be dismissed. */
  pending?: boolean;
  confirmVariant?: ComponentProps<typeof Button>['variant'];
  /**
   * Disables only the confirm button, for a confirmation that is not ready
   * yet (for example while what it will do is still loading). Unlike
   * `pending`, the dialog can still be cancelled.
   */
  confirmDisabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <AlertDialogContent className="max-w-[calc(100%-2rem)] sm:max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

'use client';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@campuspilot/ui/components/alert-dialog';
import { ExamButton } from './exam-controls';

/** Discard is an explicit choice in the app; closing keeps the editor intact. */
export function ExamDiscardDialog({
  open,
  onOpenChange,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[calc(100%-2rem)] sm:max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved results?</AlertDialogTitle>
          <AlertDialogDescription>
            Your changes will be lost. Saved results will stay as they were.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <ExamButton variant="outline" onClick={() => onOpenChange(false)}>
            Keep editing
          </ExamButton>
          <ExamButton variant="destructive" onClick={onDiscard}>
            Discard changes
          </ExamButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

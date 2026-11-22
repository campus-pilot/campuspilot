import { Button } from '@campuspilot/ui/components/button';
import { ButtonGroup } from '@campuspilot/ui/components/button-group';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@campuspilot/ui/components/dropdown-menu';
import { ChevronDown, Download, FileText } from 'lucide-react';

/** The formats a saved version downloads in: its printed PDF, or an editable Word file made from the same version. */
export type VersionDownloadFormat = 'pdf' | 'docx';

/** The name of the Word download wherever it is offered. */
export const WORD_DOWNLOAD_LABEL = 'Download Word (.docx)';

/** The one line said wherever the Word file is offered: the download is one way. */
export const WORD_DOWNLOAD_NOTE = 'Edits made in Word are not saved back to CampusPilot.';

/** What the download control says while a file is being prepared: which file, since the Word one is made on its first download. */
export const PREPARING_LABEL: Record<VersionDownloadFormat, string> = { pdf: 'Preparing PDF…', docx: 'Preparing Word…' };

/**
 * Download PDF as the main action, with a menu beside it that offers the same
 * version as an editable Word file (docs/question-papers.md "Word download").
 * While a file is being prepared (the first Word download of a version makes
 * it) both controls wait and the button says which file is being prepared
 * ({@link PREPARING_LABEL}): the menu has closed by then, so the button is
 * where the progress shows. `size` follows the surrounding row (the chat
 * card's and the version list's buttons are small). `subject` names what is
 * downloaded for screen readers when several of these share a screen
 * ("version 2").
 */
export function VersionDownloadButtons({
  pending,
  onDownload,
  size = 'default',
  subject,
}: {
  /** The format being prepared, or null. */
  pending: VersionDownloadFormat | null;
  onDownload: (format: VersionDownloadFormat) => void;
  size?: 'default' | 'sm';
  subject?: string;
}) {
  const busy = pending !== null;
  return (
    <ButtonGroup aria-label={subject ? `Download ${subject}` : 'Download'}>
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={busy}
        aria-label={subject && !busy ? `Download PDF of ${subject}` : undefined}
        onClick={() => onDownload('pdf')}
      >
        <Download data-icon="inline-start" aria-hidden /> {pending ? PREPARING_LABEL[pending] : 'Download PDF'}
      </Button>
      <DownloadFormatMenu disabled={busy} size={size} subject={subject} onWord={() => onDownload('docx')} />
    </ButtonGroup>
  );
}

/** The menu of other formats: today the Word file, with the note that edits there stay there. */
function DownloadFormatMenu({ disabled, size, subject, onWord }: { disabled: boolean; size: 'default' | 'sm'; subject: string | undefined; onWord: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size={size === 'sm' ? 'icon-sm' : 'icon'} disabled={disabled} aria-label={subject ? `More download formats for ${subject}` : 'More download formats'}>
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-72">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onWord} className="items-start">
            <FileText aria-hidden className="mt-1" />
            <span className="flex flex-col">
              <span>{WORD_DOWNLOAD_LABEL}</span>
              <span className="text-muted-foreground">{WORD_DOWNLOAD_NOTE}</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * "Download latest PDF" and its Word sibling, for a paper's overflow menu.
 * Render inside a `DropdownMenuGroup` of a `DropdownMenuContent` (they are
 * Radix menu items). While a file is being prepared the item of that format
 * says so (the menu may be opened again meanwhile).
 */
export function LatestVersionDownloadItems({
  disabled,
  pending,
  onDownload,
}: {
  disabled: boolean;
  pending: VersionDownloadFormat | null;
  onDownload: (format: VersionDownloadFormat) => void;
}) {
  return (
    <>
      <DropdownMenuItem disabled={disabled || pending !== null} onSelect={() => onDownload('pdf')}>
        <Download aria-hidden />
        {pending === 'pdf' ? PREPARING_LABEL.pdf : 'Download latest PDF'}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={disabled || pending !== null} onSelect={() => onDownload('docx')} className="items-start">
        <FileText aria-hidden className="mt-1" />
        <span className="flex flex-col">
          <span>{pending === 'docx' ? PREPARING_LABEL.docx : 'Download latest as Word (.docx)'}</span>
          <span className="text-muted-foreground">{WORD_DOWNLOAD_NOTE}</span>
        </span>
      </DropdownMenuItem>
    </>
  );
}

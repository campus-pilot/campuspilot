import { Button } from '@campuspilot/ui/components/button';
import { ButtonGroup } from '@campuspilot/ui/components/button-group';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@campuspilot/ui/components/dropdown-menu';
import { ChevronDown, Download, FileText } from 'lucide-react';

/** The formats a saved version downloads in: its printed PDF, or an editable Word file made from the same version. */
export type VersionDownloadFormat = 'pdf' | 'docx';

/** The one line said wherever the Word file is offered: the download is one way. */
export const WORD_DOWNLOAD_NOTE = 'Edits made in Word are not saved back to CampusPilot.';

/**
 * Download PDF as the main action, with a menu beside it that offers the same
 * version as an editable Word file (docs/question-papers.md "Word download").
 * While either file is being prepared (the first Word download of a version is
 * made then) both controls wait and the button says "Preparing…". `size`
 * follows the surrounding row (the chat card's buttons are small).
 */
export function VersionDownloadButtons({
  pending,
  onDownload,
  size = 'default',
}: {
  /** The format being prepared, or null. */
  pending: VersionDownloadFormat | null;
  onDownload: (format: VersionDownloadFormat) => void;
  size?: 'default' | 'sm';
}) {
  const busy = pending !== null;
  return (
    <ButtonGroup aria-label="Download">
      <Button type="button" variant="outline" size={size} disabled={busy} onClick={() => onDownload('pdf')}>
        <Download data-icon="inline-start" aria-hidden /> {busy ? 'Preparing…' : 'Download PDF'}
      </Button>
      <DownloadFormatMenu disabled={busy} size={size} onWord={() => onDownload('docx')} />
    </ButtonGroup>
  );
}

/** The menu of other formats: today the Word file, with the note that edits there stay there. */
function DownloadFormatMenu({ disabled, size, onWord }: { disabled: boolean; size: 'default' | 'sm'; onWord: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size={size === 'sm' ? 'icon-sm' : 'icon'} disabled={disabled} aria-label="More download formats">
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-72">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onWord} className="items-start">
            <FileText aria-hidden className="mt-1" />
            <span className="flex flex-col">
              <span>Download Word (.docx)</span>
              <span className="text-muted-foreground">{WORD_DOWNLOAD_NOTE}</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

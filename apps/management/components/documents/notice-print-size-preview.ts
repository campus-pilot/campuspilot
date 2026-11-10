import { z } from 'zod';
import type { DocumentType } from '@campuspilot/api/routers/school/document/document.dto';

/** The print size a Notice design is previewed at (`print.size`); never saved with a revision. */
export const noticePreviewPrintSizeSchema = z.enum(['full', 'half']);
export type NoticePreviewPrintSize = z.infer<typeof noticePreviewPrintSizeSchema>;

/**
 * A Notice design has no footprint of its own: each notice chooses full or
 * half A4 and the design adapts to `print.size`. So instead of a saved
 * paper footprint, the Notice template editor (Settings › Templates) and the
 * marketplace preview offer the size to preview at.
 */
export const noticePrintSizeOptions = [
  { value: 'full', label: 'Full A4 notice' },
  { value: 'half', label: 'Half A4 notice · two per sheet' },
] as const satisfies readonly { value: NoticePreviewPrintSize; label: string }[];

/**
 * The `getMarketplaceTemplate` input of a marketplace preview. `printSize`
 * is sent for Notice designs only: the server refuses it for every other
 * document type rather than ignoring it.
 */
export function marketplaceTemplatePreviewInput(
  scope: { schoolId: string; documentType: DocumentType },
  slug: string,
  printSize: NoticePreviewPrintSize,
) {
  return {
    ...scope,
    slug,
    ...(scope.documentType === 'notice' ? { printSize } : {}),
  };
}

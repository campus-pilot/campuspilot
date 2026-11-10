import type { ReactNode } from 'react';
import { ChevronRightIcon, MegaphoneIcon } from 'lucide-react';

import { DocumentPreview } from '../documents/document-controls';

/**
 * API-free pieces of the Cadet Portal's notice screens. A notice reaches a
 * student in one of two shapes, and each is read differently on a phone:
 * - a notice written as plain text is shown as text ({@link CadetNoticeText}):
 *   it wraps to the phone's width at the reader's font size, instead of an
 *   A4 sheet scaled down to a few millimetres of type;
 * - a notice designed as a document has no text form, so it is shown as the
 *   printed page ({@link CadetNoticeDocument}) in the same empty-sandbox
 *   frame the staff app uses.
 * Either way the PDF is the exact sheet the school published.
 */

/**
 * The paragraphs of a plain-text notice: split at blank lines, single line
 * breaks kept inside a paragraph, trailing spaces and empty paragraphs
 * dropped. The same rule as the server's `noticeParagraphs`
 * (`routers/school/notice/notice.render.ts`), which fills the printed
 * notice, so the screen and the PDF break the text in the same places.
 */
export function cadetNoticeParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*(?:\n[ \t]*)+/)
    .map((paragraph) => paragraph.replace(/[ \t]+$/gm, '').trim())
    .filter((paragraph) => paragraph.length > 0);
}

/**
 * A plain-text notice as text. React escapes it: markup or template syntax
 * an author typed is shown, never interpreted (as in the printed notice).
 */
export function CadetNoticeText({ text }: { text: string }) {
  const paragraphs = cadetNoticeParagraphs(text);
  if (paragraphs.length === 0) return <p className="text-sm text-muted-foreground">This notice has no text.</p>;
  return (
    <article className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-[0.9375rem] leading-relaxed">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
          {paragraph}
        </p>
      ))}
    </article>
  );
}

/** The preview's caption and frame title; the notice's own title is the screen heading above it. */
export const CADET_NOTICE_DOCUMENT_LABEL = 'Notice as printed';

/**
 * A designed notice as its printed page: the server's sanitized HTML in the
 * shared empty-sandbox preview, laid out at A4 width and scaled to the
 * phone (`fitPageWidth`), so the layout the school designed is kept.
 */
export function CadetNoticeDocument({ html }: { html: string }) {
  return (
    <div className="flex flex-col gap-2">
      <DocumentPreview fitPageWidth html={html} label={CADET_NOTICE_DOCUMENT_LABEL} />
      <p className="text-xs text-muted-foreground">Shown as the printed page. Download the PDF to zoom in or print it.</p>
    </div>
  );
}

/**
 * The content of one row of a notice list; the app wraps it in its own link
 * (`renderLink`), since this package does not route.
 */
export function CadetNoticeRow({ title, detail }: { title: string; detail: string }) {
  return (
    <>
      <MegaphoneIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere]">{title}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </>
  );
}

/** One notice of {@link CadetNoticeList}. */
export type CadetNoticeListEntry = { noticeId: string; title: string; detail: string; href: string };

/** Props of the link a notice row is wrapped in. */
export type CadetNoticeLinkProps = { href: string; className: string; children: ReactNode };

/** Notices as a bordered list of links, in the order given. */
export function CadetNoticeList({ entries, renderLink }: { entries: CadetNoticeListEntry[]; renderLink: (props: CadetNoticeLinkProps) => ReactNode }) {
  return (
    <ul className="flex flex-col overflow-hidden rounded-lg border">
      {entries.map((entry) => (
        <li key={entry.noticeId} className="border-b last:border-b-0">
          {renderLink({
            href: entry.href,
            className: 'flex items-center gap-3 px-3 py-3 hover:bg-muted/50',
            children: <CadetNoticeRow title={entry.title} detail={entry.detail} />,
          })}
        </li>
      ))}
    </ul>
  );
}

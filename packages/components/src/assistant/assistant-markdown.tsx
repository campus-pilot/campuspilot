import { isValidElement, memo, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { AssistantCopyButton } from './assistant-copy-button';

/**
 * Splits markdown at blank lines that close every open block (outside code
 * fences), so a streaming reply re-parses only its last block while earlier
 * blocks stay memoised (after T3 Code's markdown stream blocks).
 */
export function splitMarkdownBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === '' && current.length) {
      blocks.push(current.join('\n'));
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join('\n'));
  return blocks;
}

/** The fenced code's language and source, read from the `<code>` react-markdown nests in `<pre>`. */
function fencedCode(children: ReactNode): { language: string | null; source: string } {
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children.props : null;
  const language = code?.className?.match(/language-([\w-]+)/)?.[1] ?? null;
  const source = typeof code?.children === 'string' ? code.children.replace(/\n$/, '') : '';
  return { language, source };
}

/** Code in an inset well under a 32px header: language on the left, copy on the right (T3 Code). */
function CodeBlock({ children, ...props }: ComponentProps<'pre'>) {
  const { language, source } = fencedCode(children);
  return (
    <div className="assistant-codeblock overflow-hidden rounded-lg assistant-well">
      <div className="flex h-8 items-center justify-between gap-2 bg-[var(--assistant-well-header)] ps-3.5 pe-1 shadow-[inset_0_-1px_var(--assistant-hairline)] select-none">
        <span className="truncate font-mono text-[11px] text-muted-foreground">{language ?? 'text'}</span>
        {source ? <AssistantCopyButton text={source} label="Copy code" /> : null}
      </div>
      <pre {...props}>{children}</pre>
    </div>
  );
}

const components: Components = {
  // Wide tables scroll inside their own well instead of widening the lane.
  table: (props: ComponentProps<'table'>) => (
    <div className="assistant-markdown-table assistant-well">
      <table {...props} />
    </div>
  ),
  pre: CodeBlock,
  a: ({ href, ...props }: ComponentProps<'a'>) => (
    <a href={href} target="_blank" rel="noreferrer noopener" {...props} />
  ),
  img: MarkdownImage,
};

/**
 * An image in a reply is shown as its description, never loaded. A browser
 * fetches an image the moment it renders, with no click, so an image URL is
 * a way to send data out: text planted in school records (a student's name,
 * a note) could talk the model into writing one whose address carries what
 * it just read. The assistant shows data through views, so nothing is lost.
 */
function MarkdownImage({ alt }: ComponentProps<'img'>) {
  return alt ? <span>{alt}</span> : null;
}

const MarkdownBlock = memo(function MarkdownBlock({ source }: { source: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {source}
    </ReactMarkdown>
  );
});

/**
 * Assistant prose. Raw HTML is never rendered (react-markdown's default)
 * and images are never loaded (see `MarkdownImage`).
 * While `streaming`, each newly appended block fades in (see assistant.css).
 */
export function AssistantMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div className="assistant-markdown" data-streaming={streaming ? '' : undefined}>
      {splitMarkdownBlocks(text).map((block, index) => (
        <MarkdownBlock key={index} source={block} />
      ))}
    </div>
  );
}

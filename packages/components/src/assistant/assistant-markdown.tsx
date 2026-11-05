import { memo, type ComponentProps } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

const components: Components = {
  // Wide tables scroll inside their own box instead of widening the lane.
  table: (props: ComponentProps<'table'>) => (
    <div className="assistant-markdown-table">
      <table {...props} />
    </div>
  ),
  a: ({ href, ...props }: ComponentProps<'a'>) => (
    <a href={href} target="_blank" rel="noreferrer noopener" {...props} />
  ),
};

const MarkdownBlock = memo(function MarkdownBlock({ source }: { source: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {source}
    </ReactMarkdown>
  );
});

/**
 * Assistant prose. Raw HTML is never rendered (react-markdown's default).
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

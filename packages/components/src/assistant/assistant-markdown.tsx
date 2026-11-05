import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
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

const MarkdownBlock = memo(function MarkdownBlock({ source }: { source: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>;
});

/** Assistant markdown. Raw HTML is not rendered (react-markdown's default). */
export function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="assistant-markdown flex min-w-0 flex-col gap-2 text-xs/relaxed [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_li]:ml-4 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc">
      {splitMarkdownBlocks(text).map((block, index) => (
        <MarkdownBlock key={index} source={block} />
      ))}
    </div>
  );
}

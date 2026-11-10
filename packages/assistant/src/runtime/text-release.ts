/**
 * Decides how much of a streaming reply to show, after T3 Code's paragraph
 * streaming: whole lines as they complete, so the reader sees calm block
 * updates instead of token jitter. A long line still flows: after
 * `holdMs` without a line break, whole words are released. Inside an open
 * code fence only whole lines go out, so code never renders half a token.
 */
export function createTextRelease({
  publish,
  holdMs = 450,
  now = () => Date.now(),
}: {
  /** Called in order with each newly released slice. */
  publish: (release: { offset: number; delta: string; text: string }) => void;
  holdMs?: number;
  now?: () => number;
}) {
  let released = 0;
  let heldSince: number | null = null;

  return (text: string) => {
    if (text.length <= released) return;
    const fenceOpen = ((text.match(/^\s*(```|~~~)/gm) ?? []).length) % 2 === 1;
    let end = text.lastIndexOf('\n') + 1;
    if (end <= released && !fenceOpen) {
      heldSince ??= now();
      if (now() - heldSince >= holdMs) {
        const wordEnd = text.lastIndexOf(' ') + 1;
        end = wordEnd > released ? wordEnd : released;
      }
    }
    if (end <= released) return;
    publish({ offset: released, delta: text.slice(released, end), text: text.slice(0, end) });
    released = end;
    heldSince = null;
  };
}

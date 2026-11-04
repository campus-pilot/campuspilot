/**
 * Hand-drawn primitives shared by every part of the `/3` sketchbook page.
 *
 * Every stroke uses `pathLength="1"` so CSS can "draw" it with a normalised
 * `stroke-dasharray: 1` / `stroke-dashoffset` pair without measuring paths.
 * All of them are decorative and therefore `aria-hidden`.
 */

/** Wobbly marker underline, stretched to the width of its parent. */
export function Squiggle({ className = "" }: { className?: string }) {
  return (
    <svg className={`d3-squiggle ${className}`} viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true">
      <path pathLength={1} d="M3 13 C 32 6, 62 17, 96 10 S 162 5, 197 11" />
    </svg>
  );
}

/** Loose hand-drawn ellipse with an overlapping tail, as when circling a word with a pen. */
export function ScribbleCircle({ className = "" }: { className?: string }) {
  return (
    <svg className={`d3-circle ${className}`} viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
      <path
        pathLength={1}
        d="M168 9 C 78 3, 9 25, 11 55 C 13 85, 96 97, 172 92 C 252 87, 296 64, 289 39 C 282 13, 206 3, 118 11 C 88 14, 62 20, 46 28"
      />
    </svg>
  );
}

/** Curly doodled arrow pointing right/down. */
export function DoodleArrow({ className = "" }: { className?: string }) {
  return (
    <svg className={`d3-arrow ${className}`} viewBox="0 0 120 80" aria-hidden="true">
      <path pathLength={1} d="M6 12 C 22 58, 64 72, 106 52" />
      <path pathLength={1} d="M88 41 L 107 52 L 90 65" />
    </svg>
  );
}

/** Small five-point doodle star used as a margin flourish. */
export function DoodleStar({ className = "" }: { className?: string }) {
  return (
    <svg className={`d3-star ${className}`} viewBox="0 0 40 40" aria-hidden="true">
      <path pathLength={1} d="M20 4 L 24 15 L 36 15 L 26 23 L 30 35 L 20 27 L 10 35 L 14 23 L 4 15 L 16 15 Z" />
    </svg>
  );
}

/** Hand-drawn tick inside a wobbly box, the "done" mark of the checklist. */
export function DoodleCheck({ className = "" }: { className?: string }) {
  return (
    <svg className={`d3-check ${className}`} viewBox="0 0 32 32" aria-hidden="true">
      <path className="d3-check-box" d="M5 6 C 12 4, 22 5, 27 5 C 28 12, 27 21, 27 27 C 19 28, 11 27, 5 27 C 4 19, 5 12, 5 6 Z" />
      <path className="d3-check-tick" pathLength={1} d="M9 16 L 14 22 L 29 3" />
    </svg>
  );
}

/** A strip of semi-transparent tape, positioned by the parent through a modifier class. */
export function Tape({ className = "" }: { className?: string }) {
  return <span className={`d3-tape ${className}`} aria-hidden="true" />;
}

/**
 * SVG filter definitions referenced from CSS (`filter: url(#d3-pencil)`).
 * The turbulence displacement roughens perfectly smooth vector strokes so they
 * read as pencil lines; it is only applied to decorative line art, never text.
 */
export function SketchFilters() {
  return (
    <svg className="d3-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <filter id="d3-pencil" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.6" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <pattern id="d3-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-40)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#e48618" strokeWidth="2.2" />
        </pattern>
        <pattern id="d3-hatch-ink" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="#171713" strokeWidth="1.2" strokeOpacity="0.55" />
        </pattern>
      </defs>
    </svg>
  );
}

/**
 * Ref callback (React 19, with cleanup) that "arms" an element for its
 * draw-in animation and flags it with `data-inview` once it scrolls into view.
 *
 * Why not CSS scroll timelines alone: the drawings should play once, at their
 * own pace, with staggered delays — scroll-linked timelines would scrub them
 * back and forth. Why `data-armed`: until this runs (or if it never does) the
 * artwork stays fully drawn, so nothing is ever hidden without JavaScript.
 * The observer disconnects after the first reveal; no React state is involved.
 */
export function revealOnView(node: HTMLElement | null) {
  if (!node) return;
  node.dataset.armed = "";
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        node.dataset.inview = "";
        observer.disconnect();
      }
    },
    { threshold: 0.2, rootMargin: "0px 0px -8% 0px" },
  );
  observer.observe(node);
  return () => observer.disconnect();
}

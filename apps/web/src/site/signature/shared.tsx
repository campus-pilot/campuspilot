/**
 * Small helpers shared by the signature components. Not exported from the
 * signature index: page code never needs them.
 */

/**
 * Ref callback (React 19, with cleanup) that "arms" an element for its
 * scroll-in animation and flags it with `data-inview` once it is visible.
 *
 * Why not CSS scroll timelines alone: the drawings should play once, at their
 * own pace, with staggered delays; scroll-linked timelines would scrub them back
 * and forth. Why `data-armed`: until this runs (or if it never does, e.g. no JS)
 * the artwork stays in its finished state, so nothing is ever hidden without
 * JavaScript. The observer disconnects after the first reveal; no React state.
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

/** `--i` drives staggered animation delays in `signature.css`. */
export function stagger(index: number) {
  return { "--i": index } as React.CSSProperties;
}

/** Visually hidden text for screen readers. */
export function SrOnly({ children }: { children: React.ReactNode }) {
  return <span className="cp-sig-sr">{children}</span>;
}

/**
 * Accessibility props for an illustration: decorative (`aria-hidden`) by
 * default, or a single labelled image when the caller passes `label`.
 */
export function artA11y(label: string | undefined) {
  return label ? ({ role: "img", "aria-label": label } as const) : ({ "aria-hidden": true } as const);
}

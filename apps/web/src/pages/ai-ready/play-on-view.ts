/**
 * Ref callback (React 19, with cleanup) for one-off entrance animations on
 * this page. It "arms" the element (`data-armed`) and flags it with
 * `data-inview` the first time it scrolls into view, then stops observing.
 *
 * Why a ref callback and not CSS scroll timelines: the sequences should play
 * once, at their own pace, with staggered delays; a scroll-linked timeline
 * would scrub them back and forth. Why `data-armed`: until this runs (or if it
 * never does), the element keeps its finished, readable state. `page.css`
 * hides the initial state only under `[data-armed]:not([data-inview])` and
 * only when `prefers-reduced-motion` is `no-preference`.
 */
export function playOnView(node: HTMLElement | null) {
  if (!node) return;
  node.dataset.armed = "";
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        node.dataset.inview = "";
        observer.disconnect();
      }
    },
    { threshold: 0.25, rootMargin: "0px 0px -8% 0px" },
  );
  observer.observe(node);
  return () => observer.disconnect();
}

/** `--i` drives staggered animation delays in `page.css`. */
export function stagger(index: number) {
  return { "--i": index } as React.CSSProperties;
}

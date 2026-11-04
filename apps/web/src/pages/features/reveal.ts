/**
 * Ref callback (React 19, with cleanup) that plays an element's entrance
 * animation once, when it first scrolls into view.
 *
 * It sets `data-armed` (CSS may now hold the element in its initial state) and
 * `data-inview` once at least a fifth of it is visible; the observer then
 * disconnects, so the animation never scrubs back. Without JavaScript the
 * attributes never appear and the element simply shows its finished state.
 * Used instead of `animation-timeline: view()` because the steps should play at
 * their own pace with staggered delays, not follow the scroll position.
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
    { threshold: 0.2, rootMargin: "0px 0px -8% 0px" },
  );
  observer.observe(node);
  return () => observer.disconnect();
}

/** `--i` drives staggered animation delays in `page.css`. */
export function staggerStyle(index: number) {
  return { "--i": index } as React.CSSProperties;
}

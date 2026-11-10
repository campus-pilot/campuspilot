/**
 * jsdom lacks the layout APIs Radix Popper and cmdk call while a popup is
 * open. These no-op stand-ins only let the components mount; tests do not
 * assert positioning or scrolling.
 */
export function installPopupDomStubs() {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
}

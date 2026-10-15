'use client';

const guards = new Set<() => boolean>();

/** Registers a mounted editor's keep/discard decision for programmatic shell navigation. */
export function registerNavigationGuard(guard: () => boolean) {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

/** School/session switchers consult mounted editors before changing scope or stored selections. */
export function confirmNavigation() {
  return [...guards].every((guard) => guard());
}

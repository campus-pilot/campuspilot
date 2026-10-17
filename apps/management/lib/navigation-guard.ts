'use client';

const guards = new Set<() => boolean | Promise<boolean>>();

/** Registers a mounted editor's keep/discard decision for programmatic shell navigation. */
export function registerNavigationGuard(guard: () => boolean | Promise<boolean>) {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

/** School/session switchers consult mounted editors before changing scope or stored selections. */
export async function confirmNavigation() {
  for (const guard of guards) {
    if (!(await guard())) return false;
  }
  return true;
}

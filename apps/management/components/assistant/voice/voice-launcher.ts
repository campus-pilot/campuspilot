/**
 * How the top bar's voice button reaches the overlay's chat, which is mounted
 * far from it (the school layout, above the shell that holds the button).
 *
 * The overlay registers the function that starts voice in its chat; the button
 * calls it. The call is synchronous, inside the user's click: browsers open a
 * microphone and play sound only from one.
 */
let start: (() => void) | null = null;

/** Registers the overlay's start function; returns the function that removes it. */
export function registerVoiceLauncher(launch: () => void): () => void {
  start = launch;
  return () => {
    if (start === launch) start = null;
  };
}

/** Starts voice in the overlay. Call from a click handler. Does nothing when no overlay is mounted. */
export function launchVoice(): void {
  start?.();
}

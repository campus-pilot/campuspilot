'use client';

/**
 * The quiet way into the assistant (decision D11): underlined text under the
 * result. With `onNavigate`, an unmodified click navigates inside the app;
 * a modified click or a missing handler falls back to the plain link.
 */
export function ContinueInChatLink({ href, onNavigate }: { href: string; onNavigate?: () => void }) {
  return (
    <a
      href={href}
      className="w-fit text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
      onClick={(event) => {
        if (!onNavigate || event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate();
      }}
    >
      Want to update something? Continue in chat
    </a>
  );
}

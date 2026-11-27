/**
 * A section at the top of the message box saying the school's AI allowance
 * is nearly used (from 80%), with when it resets: the panel's inline
 * warning, like the voice notice. Not dismissible: it stays true until the
 * allowance resets.
 */
export function AssistantAllowanceNotice({ message }: { message: string }) {
  return (
    <p role="status" className="px-3 py-1.5 text-xs text-assistant-warning">
      {message}
    </p>
  );
}

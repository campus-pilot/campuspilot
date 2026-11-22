/**
 * The CampusPilot assistant as staff see it in the management app: a round
 * orange head wearing the cap of the CampusPilot mark. Same drawing as the
 * app's voice avatar (`AssistantVoiceAvatar` in `@campuspilot/components`),
 * redrawn here because the site does not load the app's component styles and
 * has no live audio levels: it only blinks, and `speaking` adds a gentle pulse.
 *
 * Decorative: always paired with the word "Assistant" or a described picture.
 */
export function AssistantMark({ speaking = false, className = "" }: { speaking?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 96 96"
      aria-hidden="true"
      data-speaking={speaking || undefined}
      className={`cp-mark ${className}`.trim()}
    >
      <g className="cp-mark-body">
        <circle className="cp-mark-head" cx="48" cy="58" r="28" />
        <g className="cp-mark-eyes">
          <rect x="35" y="52.5" width="7.5" height="13" rx="3.75" />
          <rect x="53.5" y="52.5" width="7.5" height="13" rx="3.75" />
        </g>
        <g transform="translate(48 22) rotate(-7) scale(1.3) translate(-34.5 -30)">
          <path className="cp-mark-hat" strokeWidth="0" d="M26.5 35 34.5 39 42.5 35V40C42.5 42 39 44 34.5 44S26.5 42 26.5 40Z" />
          <path className="cp-mark-hat" strokeWidth="2" strokeLinejoin="round" d="M34.5 21.5 49 28 34.5 34.5 20 28Z" />
          <path className="cp-mark-tassel" d="M46.5 29V37.5" />
        </g>
      </g>
    </svg>
  );
}

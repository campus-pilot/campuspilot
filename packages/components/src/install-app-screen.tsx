"use client";

import { Button } from "@campuspilot/ui/components/button";
import { Download } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

/**
 * What the screen shows in place of the install button.
 * - `ready`: the install button.
 * - `ios` / `android`: manual steps, for browsers that cannot open the
 *   install dialog from a button (iPhone, Firefox, or an app that is
 *   already installed).
 * - `installed`: the install was accepted; the app opens from the home screen.
 */
export type InstallAppScreenStatus = "ready" | "ios" | "android" | "installed";

export type InstallAppScreenProps = {
  /** A small (avatar-sized) school logo shown beside the name. */
  schoolLogo: ReactNode;
  schoolName: string;
  status: InstallAppScreenStatus;
  onInstall: () => void;
  onContinue: () => void;
};

const INSTRUCTIONS: Record<Exclude<InstallAppScreenStatus, "ready">, string> = {
  ios: "Tap the Share button, then “Add to Home Screen”.",
  android:
    "Open the browser menu and choose “Install app” or “Add to Home screen”. If it is already installed, open it from your home screen.",
  installed: "Installed. Open it from your home screen.",
};

/**
 * Looping keyframes used through Tailwind's arbitrary `animate-[…]`
 * classes. Rendered as a React 19 hoisted `<style>`: the `href` dedupes it,
 * and it needs no global stylesheet edit. Entrance motion uses
 * `tw-animate-css` (already imported by the UI globals) instead.
 */
const KEYFRAMES = `
@keyframes install-travel {
  0% { opacity: 0; translate: 0 0; }
  15% { opacity: 1; translate: 0 0; }
  70% { opacity: 1; translate: 109px 0; }
  85%, 100% { opacity: 0; translate: 109px 0; }
}
@keyframes install-grow-x { from { scale: 0 1; } }
`;

/**
 * Staggered entrance: fade and a short rise with the marketing site's
 * `cubic-bezier(0.22, 1, 0.36, 1)` ease (its `cp-enter`). Every animated
 * element's base style is its finished state, so `motion-safe:` switches
 * motion off without hiding anything. Delays are motion-safe too, because
 * Tailwind's `delay-*` also delays transitions.
 */
const ENTER =
  "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] motion-safe:fill-mode-both";
const DELAYS = [
  "motion-safe:delay-0",
  "motion-safe:delay-300",
  "motion-safe:delay-[450ms]",
] as const;
const enter = (step: 0 | 1 | 2) => `${ENTER} ${DELAYS[step]}`;

/**
 * Full-screen, always-black invitation to install a school's app, in the
 * marketing site's framed style: a narrow column bounded by hairline guide
 * lines, split by a rule with "+" marks where they cross. An app tile
 * travels from a browser window into a phone.
 *
 * The school leads, set apart as the headline; the recommendation, the
 * install button and "Continue here" follow as one tight group.
 *
 * It covers the page beneath it; the caller decides when it appears. The
 * `dark` class pins dark theme tokens, so the button and borders read well
 * on black whatever the user's theme.
 */
export function InstallAppScreen({
  schoolLogo,
  schoolName,
  status,
  onInstall,
  onContinue,
}: InstallAppScreenProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-app-title"
      className="dark fixed inset-0 z-50 flex justify-center overflow-y-auto overscroll-contain bg-black px-4 text-white"
    >
      <style href="campuspilot-install-app-screen-keyframes" precedence="default">
        {KEYFRAMES}
      </style>
      <div className="flex w-full max-w-sm min-w-0 flex-col justify-center border-x border-white/10">
        <div className={`flex justify-center px-6 pb-10 ${enter(0)}`}>
          <BrowserToPhoneIllustration />
        </div>
        <FrameRule />
        <div className="flex min-w-0 flex-col items-center gap-8 px-6 pt-10 text-center">
          <SchoolHeadline
            schoolLogo={schoolLogo}
            schoolName={schoolName}
            className={enter(1)}
          />
          <div className={`flex flex-col items-center gap-3 ${enter(2)}`}>
            <p id="install-app-title" className="text-[13px] text-white/55">
              We recommend installing the app
            </p>
            <InstallAction status={status} onInstall={onInstall} />
            <ContinueHere onContinue={onContinue} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Install button, or the manual steps when no install dialog can open.
 * Uses the shared `lg` size; only width and label size are set here. The
 * label is raised from the size's `text-xs` to `text-sm` because the screen
 * has a single action and its label must read at a glance on a phone.
 */
function InstallAction({
  status,
  onInstall,
}: {
  status: InstallAppScreenStatus;
  onInstall: () => void;
}) {
  if (status === "ready") {
    return (
      <Button
        variant="secondary"
        size="lg"
        className="w-36 border-white/15 text-sm"
        onClick={onInstall}
      >
        <Download data-icon="inline-start" />
        Install
      </Button>
    );
  }
  return (
    <p className="max-w-xs text-sm text-pretty text-white/75">
      {INSTRUCTIONS[status]}
    </p>
  );
}

function ContinueHere({ onContinue }: { onContinue: () => void }) {
  return (
    <button
      type="button"
      onClick={onContinue}
      className="text-[13px] text-white/50 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white/80"
    >
      Continue here
    </button>
  );
}

/**
 * School name as the column's headline, logo leading. Long names (real
 * schools run to several words) stay on one line and end in an ellipsis;
 * the full name is kept in `title`.
 */
function SchoolHeadline({
  schoolLogo,
  schoolName,
  className,
}: Pick<InstallAppScreenProps, "schoolLogo" | "schoolName"> & {
  className: string;
}) {
  return (
    <div className={`flex max-w-full min-w-0 items-center gap-2.5 ${className}`}>
      <span className="shrink-0">{schoolLogo}</span>
      <span
        title={schoolName}
        className="min-w-0 truncate text-xl font-semibold tracking-[-0.03em]"
      >
        {schoolName}
      </span>
    </div>
  );
}

/** Horizontal hairline that grows from the center, with "+" marks on the guide lines. */
function FrameRule() {
  return (
    <div className="relative h-px">
      <div className="h-px bg-white/10 motion-safe:animate-[install-grow-x_900ms_cubic-bezier(0.22,1,0.36,1)_300ms_both]" />
      <PlusMark className="-left-[5px]" />
      <PlusMark className="-right-[5px]" />
    </div>
  );
}

function PlusMark({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 9 9"
      className={`absolute -top-1 size-[9px] text-white/40 ${className}`}
    >
      <path d="M4.5 0v9M0 4.5h9" stroke="currentColor" />
    </svg>
  );
}

/**
 * The tile starts moving once the frame has settled. Its 109px travel (in
 * `install-travel`, and the reduced-motion resting offset) carries it from
 * the browser window's center into the phone's slot.
 */
const TRAVEL_STYLE: CSSProperties = { animationDelay: "800ms" };

/** Browser window on the left, phone on the right, and a tile moving between them. */
function BrowserToPhoneIllustration() {
  return (
    <svg aria-hidden="true" viewBox="0 0 200 120" className="w-56" fill="none">
      <rect x="10" y="22" width="92" height="72" rx="8" stroke="rgb(255 255 255 / 0.4)" strokeWidth="1.5" />
      <path d="M10 36h92" stroke="rgb(255 255 255 / 0.2)" />
      <rect x="34" y="26" width="50" height="6" rx="3" fill="rgb(255 255 255 / 0.1)" />
      <path d="M18 29h.01M23 29h.01" stroke="rgb(255 255 255 / 0.4)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M20 80h40M20 86h26" stroke="rgb(255 255 255 / 0.12)" strokeWidth="2" strokeLinecap="round" />
      <path d="M108 60h26m-5-5 5 5-5 5" stroke="rgb(255 255 255 / 0.3)" strokeDasharray="3 3" strokeLinecap="round" />
      <rect x="140" y="14" width="50" height="92" rx="10" stroke="rgb(255 255 255 / 0.7)" strokeWidth="1.5" />
      <rect x="152" y="47" width="26" height="26" rx="7" stroke="rgb(255 255 255 / 0.22)" strokeDasharray="3 3" />
      <rect
        x="48" y="52" width="16" height="16" rx="5" fill="var(--primary)" style={TRAVEL_STYLE}
        className="motion-safe:animate-[install-travel_3s_cubic-bezier(0.65,0,0.35,1)_infinite_backwards] motion-reduce:translate-x-[109px]"
      />
    </svg>
  );
}

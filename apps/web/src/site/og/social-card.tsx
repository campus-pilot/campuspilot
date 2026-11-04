import appIcon from "../../../../../brand/campuspilot/app-icon.svg?inline";

import type { SocialCard as SocialCardCopy } from "@/site/seo";

/**
 * Social card markup for satori (build time only). Satori supports a subset of
 * CSS: every element with more than one child must be `display: flex`, and
 * styles are inline. Colours are the site tokens from `site/site.css`.
 */
const tokens = {
  bg: "#f4f4f2",
  ink: "#111110",
  muted: "#6b6b66",
  subtle: "#9b9b95",
  line: "#d4d4cf",
  accent: "#c2580e",
} as const;

function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <img src={appIcon} width={64} height={64} alt="" />
      <span style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.7 }}>CampusPilot</span>
    </div>
  );
}

function Headline({ card }: { card: SocialCardCopy }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26, maxWidth: 1000 }}>
      <span style={{ color: tokens.accent, fontSize: 24, fontWeight: 600, letterSpacing: 2.4, textTransform: "uppercase" }}>
        {card.eyebrow}
      </span>
      <div style={{ display: "flex", flexDirection: "column", fontSize: 72, fontWeight: 600, letterSpacing: -3.2, lineHeight: 1.04 }}>
        <span>{card.lead}</span>
        <span style={{ color: tokens.subtle }}>{card.accent}</span>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", borderTop: `2px solid ${tokens.line}`, paddingTop: 26, color: tokens.muted, fontSize: 24 }}>
      <span style={{ color: tokens.ink, fontWeight: 600 }}>campuspilot.in</span>
      <span>Admissions · Fees · Examinations · Documents · AI-ready</span>
    </div>
  );
}

/** The 1200 × 630 card: brand, the page's eyebrow and hero headline, and the site footer line. */
export function SocialCard({ card }: { card: SocialCardCopy }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        // Satori sizes boxes content-box by default; without this the padding pushes the footer off the canvas.
        boxSizing: "border-box",
        width: "100%",
        height: "100%",
        padding: "64px 72px 56px",
        backgroundColor: tokens.bg,
        backgroundImage: "radial-gradient(circle at 100% 0%, rgba(248, 181, 99, 0.42) 0%, rgba(248, 181, 99, 0) 46%)",
        color: tokens.ink,
        fontFamily: "Geist",
      }}
    >
      <Brand />
      <Headline card={card} />
      <Footer />
    </div>
  );
}

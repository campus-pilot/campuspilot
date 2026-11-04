import { Bot } from "lucide-react";

import { ButtonLink } from "@/site/ui/button";

const reaches = [
  ["Principal", "whole school"],
  ["Class teacher", "8 A only"],
  ["Parent", "own child only"],
] as const;

/** Decorative: the same assistant, three different reaches. */
function ReachChips() {
  return (
    <ul className="pg-sec-ai-chips" aria-hidden="true">
      {reaches.map(([who, reach]) => (
        <li key={who}><Bot />{who}<b>{reach}</b></li>
      ))}
    </ul>
  );
}

/** Link band to `/ai-ready`: the boundaries above apply to AI assistants too. */
export function AiBand() {
  return (
    <section className="cp-section pg-sec-ai" aria-labelledby="pg-sec-ai-title">
      <div className="pg-sec-ai-card">
        <div className="pg-sec-ai-copy">
          <h2 id="pg-sec-ai-title">The same boundaries hold when someone asks an AI assistant.</h2>
          <p>An assistant acts as the person asking, so it reaches exactly what they can, and nothing more.</p>
          <ButtonLink href="/ai-ready">See what AI-ready means</ButtonLink>
        </div>
        <ReachChips />
      </div>
    </section>
  );
}

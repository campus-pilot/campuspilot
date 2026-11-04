import { EyeOff, ShieldCheck, UserX, Users } from "lucide-react";

import { ButtonLink } from "@/site/ui/button";

const promises = [
  { icon: Users, title: "Never more than the person", text: "An assistant sees exactly what the person asking can see in CampusPilot." },
  { icon: EyeOff, title: "No separate copy", text: "Records are not copied into a separate AI tool. Each answer is checked when it is asked." },
  { icon: UserX, title: "Ends with their access", text: "Remove or change someone's access, and their assistant follows at once." },
] as const;

function TrustPromises() {
  return (
    <ul className="pg-ai-trust-list">
      {promises.map(({ icon: Icon, title, text }) => (
        <li key={title}>
          <Icon aria-hidden="true" />
          <p><b>{title}</b>{text}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Trust statement band: "AI access never bypasses CampusPilot security",
 * three plain promises, and the link to `/security`.
 */
export function TrustBand() {
  return (
    <section className="cp-section pg-ai-trust" aria-labelledby="pg-ai-trust-title">
      <div className="pg-ai-trust-card">
        <div className="pg-ai-trust-copy">
          <span className="pg-ai-trust-seal" aria-hidden="true"><ShieldCheck /></span>
          <h2 id="pg-ai-trust-title">AI access never bypasses CampusPilot security.</h2>
          <p>The same campus, role and class boundaries that apply to a person in CampusPilot apply to their assistant. There is no back door for AI.</p>
          <ButtonLink href="/security" tone="light">See how security works</ButtonLink>
        </div>
        <TrustPromises />
      </div>
    </section>
  );
}

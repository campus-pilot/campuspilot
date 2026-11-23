import { BrandGlyph } from "@campuspilot/components/brand-logo";

import { OnboardingCard } from "./onboarding-form";

/**
 * `/onboarding`: the School Onboarding form on a page of its own, without the
 * site's navigation, for links we send schools directly. Nothing on the site
 * links here, and the route is kept out of search (see `routes/onboarding.tsx`).
 */
export function OnboardingPage() {
  return (
    <div className="cp-page ob-page">
      <header className="ob-top">
        <a href="/" className="ob-brand" aria-label="CampusPilot home">
          <BrandGlyph product="campuspilot" width={26} height={26} />
          <span>CampusPilot</span>
        </a>
      </header>
      <main className="ob-main">
        <div className="ob-intro">
          <span className="ob-eyebrow">School onboarding</span>
          <h1>Let&apos;s set up your school</h1>
          <p>Five short steps. Pick from the ready-made lists and add anything that is missing.</p>
        </div>
        <OnboardingCard />
        <p className="ob-foot">
          We use these details only to set up CampusPilot for your school. <a href="/privacy">Privacy policy</a>
        </p>
      </main>
    </div>
  );
}

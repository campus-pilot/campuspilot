import { ArrowRight, LayoutDashboard, LockKeyhole } from "lucide-react";

import { LoginButton } from "@/site/shell/login-dialog";
import { ButtonLink, ButtonRow } from "@/site/ui/button";
import { FinalCta } from "@/site/ui/final-cta";
import { PageHero } from "@/site/ui/page-hero";

const tiles = [
  ["Session collections", "₹2,02,878"],
  ["Admissions", "85"],
  ["Students", "83"],
] as const;

/** Fee collection Jul–Nov as bar heights (%), purely illustrative. */
const bars = [42, 64, 50, 78, 58] as const;

function LockedTiles() {
  return (
    <div className="pg-util-locked-tiles">
      {tiles.map(([label, value]) => (
        <span key={label} className="pg-util-locked-tile">
          <small>{label}</small>
          <b>{value}</b>
        </span>
      ))}
    </div>
  );
}

function LockedChart() {
  return (
    <div className="pg-util-locked-chart">
      {bars.map((height, index) => (
        <i key={index} style={{ "--pg-h": `${height}%`, "--pg-i": index } as React.CSSProperties} />
      ))}
    </div>
  );
}

/**
 * Decorative, blurred preview of a session dashboard (fictional school) with a
 * lock badge on top: the real one only exists inside the management app.
 */
function LockedDashboard() {
  return (
    <div className="pg-util-locked" aria-hidden="true">
      <div className="pg-util-locked-bar">
        <b>Riverview Public School</b>
        <span>Session 2026–27</span>
      </div>
      <div className="pg-util-locked-body">
        <LockedTiles />
        <LockedChart />
      </div>
      <span className="pg-util-locked-badge">
        <LockKeyhole /> Sign in to see your school's numbers
      </span>
    </div>
  );
}

/** `/dashboard`: opens the login chooser for the management app, or points to a demo. */
export function DashboardPage() {
  return (
    <>
      <PageHero
        eyebrow="Workspace"
        eyebrowIcon={LayoutDashboard}
        title={
          <>
            The CampusPilot workspace <em>lives in the management app.</em>
          </>
        }
        description="Collections, admissions, class strength and exam progress open after you log in to your school's CampusPilot workspace, showing what your role allows."
        actions={
          <ButtonRow>
            <LoginButton className="cp-btn cp-btn-primary cp-btn-lg">
              Log in <ArrowRight aria-hidden="true" />
            </LoginButton>
            <ButtonLink href="/book-demo" size="lg" tone="light">
              Book a demo
            </ButtonLink>
          </ButtonRow>
        }
        note="New to CampusPilot? A demo shows the dashboard with your school in mind."
        visual={<LockedDashboard />}
      />
      <FinalCta />
    </>
  );
}

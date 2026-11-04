import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Building2,
  ClipboardList,
  IndianRupee,
  PenLine,
  School,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";

import type { SolutionSlug } from "@/site/content/catalog";
import { Pill, Section } from "@/site/ui/section";

type TeamChipProps = {
  slug: SolutionSlug;
  icon: LucideIcon;
  children: React.ReactNode;
  /** Punctuation that follows the chip; kept on the same line as it. */
  after?: string;
};

/** Inline link to a solution page, drawn as a small chip inside the sentence. */
function TeamChip({ slug, icon: Icon, children, after }: TeamChipProps) {
  return (
    <span className="pg-home-chip-wrap">
      <Link className="pg-home-chip" to={`/solutions/${slug}`}>
        <Icon aria-hidden="true" />
        {children}
      </Link>
      {after}
    </span>
  );
}

/**
 * One running sentence instead of a card grid: every school team (and both
 * campus set-ups) appears as an inline link to its solution page.
 */
function TeamSentence() {
  return (
    <p className="pg-home-teams-sentence">
      Whether you <TeamChip slug="school-leaders" icon={BarChart3} after=",">lead the school</TeamChip>{" "}
      <TeamChip slug="administrators" icon={ClipboardList} after=",">run the office</TeamChip>{" "}
      <TeamChip slug="teachers" icon={PenLine} after=",">teach your sections</TeamChip>{" "}
      <TeamChip slug="finance-teams" icon={IndianRupee}>keep the accounts</TeamChip> or{" "}
      <TeamChip slug="exam-teams" icon={BookOpen} after=",">run the exams</TeamChip> on{" "}
      <TeamChip slug="single-campus" icon={School}>one campus</TeamChip> or{" "}
      <TeamChip slug="multi-campus" icon={Building2} after=",">across many</TeamChip> you work from the same
      records, inside your own part of the school.
    </p>
  );
}

function TeamsHead() {
  return (
    <div className="pg-home-teams-head">
      <Pill icon={UsersRound}>Who it’s for</Pill>
      <h2 id="teams-title">Built for every school team.</h2>
      <div className="pg-home-teams-links">
        <Link className="cp-text-link" to="/solutions">
          Find your team <ArrowRight aria-hidden="true" />
        </Link>
        <Link className="cp-text-link" to="/features">
          Explore all features <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/** Compact "built for every school team" band linking into `/solutions` and `/features`. */
export function TeamsBand() {
  return (
    <Section id="teams" labelledBy="teams-title" className="pg-home-teams">
      <TeamsHead />
      <TeamSentence />
    </Section>
  );
}

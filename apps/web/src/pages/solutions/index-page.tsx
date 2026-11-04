import { ArrowRight, Compass, Eye, Network, UsersRound } from "lucide-react";
import { Link } from "react-router";

import { solutionDirectory } from "@/site/content/catalog";
import { DotsNetwork, peopleNodes, type PeopleNode } from "@/site/signature";
import { ButtonLink, ButtonRow } from "@/site/ui/button";
import { FinalCta } from "@/site/ui/final-cta";
import { PageHero } from "@/site/ui/page-hero";
import { Section, SectionIntro } from "@/site/ui/section";

import { CampusCompareSection } from "./campus-compare";

/* ───────────── Hero ───────────── */

function SolutionsHero() {
  return (
    <PageHero
      eyebrow="Solutions"
      eyebrowIcon={Compass}
      title={<>One operating system. <em>The right view for every role.</em></>}
      description="Principals, office staff, teachers, accountants and the exam cell work from the same connected records. Each of them sees the part that belongs to their job, and so does the AI assistant they ask."
      actions={
        <ButtonRow>
          <ButtonLink href="/book-demo">Book a demo</ButtonLink>
          <ButtonLink href="#by-team" tone="light">Find your role</ButtonLink>
        </ButtonRow>
      }
      note="For schools from Nursery to Class 12 · one campus or a group"
    />
  );
}

/* ───────────── People network ───────────── */

/**
 * Where each network role leads. Families and students have no solution page
 * of their own, so they point at the student portal feature.
 */
const roleHref: Record<string, string> = {
  Principal: "/solutions/school-leaders",
  Management: "/solutions/multi-campus",
  Accounts: "/solutions/finance-teams",
  Families: "/features/student-portal",
  Students: "/features/student-portal",
  Teachers: "/solutions/teachers",
  "Exam cell": "/solutions/exam-teams",
  "Office staff": "/solutions/administrators",
};

const linkedNodes: readonly PeopleNode[] = peopleNodes.map((node) => ({ ...node, href: roleHref[node.label] }));

function NetworkSection() {
  return (
    <Section id="connected" labelledBy="connected-title">
      <SectionIntro
        id="connected-title"
        eyebrow="Everyone, connected"
        eyebrowIcon={Network}
        title="Eight roles, one connected record."
        description="Work entered by one role flows on to the next: an admission becomes a fee ledger, marks become a report card. Pick a role to see what it sees."
      />
      <DotsNetwork mode="people" nodes={linkedNodes} label="School roles connected by CampusPilot; each links to its page" />
    </Section>
  );
}

/* ───────────── By team: role roster ───────────── */

/** What each team works within, shown as the roster's scope column. */
const teamScope: Record<string, string> = {
  "/solutions/school-leaders": "Whole school, read across the session",
  "/solutions/administrators": "Admissions, set-up and staff access",
  "/solutions/teachers": "Assigned classes and sections only",
  "/solutions/finance-teams": "Fees, payments, ledgers, receipts",
  "/solutions/exam-teams": "Exam plans, marks and approvals",
};

const teamEntries = solutionDirectory.filter((entry) => entry.href in teamScope);

function RosterRow({ entry, index }: { entry: (typeof solutionDirectory)[number]; index: number }) {
  const Icon = entry.icon;
  return (
    <li>
      <Link className="pg-sol-roster-row" to={entry.href}>
        <span className="pg-sol-roster-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
        <span className="pg-sol-roster-icon"><Icon aria-hidden="true" /></span>
        <span className="pg-sol-roster-text"><b>{entry.title}</b><small>{entry.text}</small></span>
        <span className="pg-sol-roster-scope"><Eye aria-hidden="true" /><span className="cp-sr-only">Sees: </span>{teamScope[entry.href]}</span>
        <ArrowRight className="pg-sol-roster-arrow" aria-hidden="true" />
      </Link>
    </li>
  );
}

/** A staff-register style list: number, team, what it does, and the scope it works within. */
function TeamRosterSection() {
  return (
    <Section id="by-team" labelledBy="by-team-title">
      <SectionIntro
        id="by-team-title"
        eyebrow="By team"
        eyebrowIcon={UsersRound}
        title="Five teams. Five views of the same school."
        description="Each team gets the workspace its job needs, and nothing outside it. The scope on the right is what that role, and its assistant, can reach."
      />
      <ol className="pg-sol-roster">
        {teamEntries.map((entry, index) => <RosterRow key={entry.href} entry={entry} index={index} />)}
      </ol>
    </Section>
  );
}

/* ───────────── Page ───────────── */

/** `/solutions`: hero → linked people network → by team roster → by institution comparison → final CTA. */
export function SolutionsIndexPage() {
  return (
    <div className="pg-sol">
      <SolutionsHero />
      <NetworkSection />
      <TeamRosterSection />
      <CampusCompareSection />
      <FinalCta
        title="Tell us who runs your school day."
        description="We'll shape the walkthrough around your roles, your campuses and your fee and exam set-up."
      />
    </div>
  );
}

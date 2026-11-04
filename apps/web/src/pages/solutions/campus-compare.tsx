import { ArrowRight, Building2, Check, Lock, School, UserRound, type LucideIcon } from "lucide-react";
import { Link } from "react-router";

import { Section, SectionIntro } from "@/site/ui/section";

/* ───────────── Boundary diagrams (decorative; the facts list carries the meaning) ───────────── */

const singleModules = ["Admissions", "Classes", "Fees", "Exams", "Documents", "Notices"] as const;

function SingleDiagram() {
  return (
    <div className="pg-sol-diagram" aria-hidden="true">
      <div className="pg-sol-boundary">
        <p className="pg-sol-boundary-label"><School />Riverview Public School</p>
        <ul className="pg-sol-chips">
          {singleModules.map((module) => <li key={module}>{module}</li>)}
        </ul>
        <p className="pg-sol-boundary-foot">one session · one shared record</p>
      </div>
    </div>
  );
}

const campusBoxes = [
  { name: "Whitefield", role: "Principal", items: ["2026–27", "Fee rules", "Letterhead"] },
  { name: "Jayanagar", role: "Exam coordinator", items: ["2026–27", "Fee rules", "Letterhead"] },
] as const;

function CampusBox({ box }: { box: (typeof campusBoxes)[number] }) {
  return (
    <div className="pg-sol-boundary">
      <p className="pg-sol-boundary-label"><Building2 />{box.name}</p>
      <span className="pg-sol-role">{box.role}</span>
      <ul className="pg-sol-chips">
        {box.items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function MultiDiagram() {
  return (
    <div className="pg-sol-diagram pg-sol-diagram-multi" aria-hidden="true">
      <p className="pg-sol-account"><UserRound />One account</p>
      <div className="pg-sol-campus-pair">
        <CampusBox box={campusBoxes[0]} />
        <span className="pg-sol-wall"><Lock /></span>
        <CampusBox box={campusBoxes[1]} />
      </div>
    </div>
  );
}

/* ───────────── Panels ───────────── */

type PanelProps = {
  id: string;
  icon: LucideIcon;
  kicker: string;
  title: string;
  text: string;
  facts: readonly string[];
  href: string;
  linkLabel: string;
  diagram: React.ReactNode;
};

function FactList({ facts }: { facts: readonly string[] }) {
  return (
    <ul className="pg-sol-facts">
      {facts.map((fact) => <li key={fact}><Check aria-hidden="true" />{fact}</li>)}
    </ul>
  );
}

function ComparePanel({ id, icon: Icon, kicker, title, text, facts, href, linkLabel, diagram }: PanelProps) {
  return (
    <article className="pg-sol-panel" aria-labelledby={id}>
      <p className="pg-sol-panel-kicker"><Icon aria-hidden="true" />{kicker}</p>
      <h3 id={id}>{title}</h3>
      <p className="pg-sol-panel-text">{text}</p>
      {diagram}
      <FactList facts={facts} />
      <Link className="cp-text-link" to={href}>{linkLabel} <ArrowRight aria-hidden="true" /></Link>
    </article>
  );
}

/**
 * By institution: single campus vs multi-campus side by side, each with a
 * small boundary diagram. The point of the pair is how campus boundaries
 * work: one boundary around one school, or one account reaching several
 * boundaries that never merge.
 */
export function CampusCompareSection() {
  return (
    <Section id="by-institution" labelledBy="by-institution-title">
      <SectionIntro
        id="by-institution-title"
        eyebrow="By institution"
        eyebrowIcon={Building2}
        title="One campus or a group. Boundaries stay clear."
        description="A single school runs on one shared record. A group gets one account per person and a separate boundary per campus."
      />
      <div className="pg-sol-compare">
        <ComparePanel
          id="compare-single"
          icon={School}
          kicker="Single campus"
          title="One school, one shared record"
          text="Admissions, classes, fees, exams and documents read the same student record, so every team works from current data."
          facts={["Guided school and session set-up", "Role-appropriate team workspaces", "School-branded documents"]}
          href="/solutions/single-campus"
          linkLabel="Single-campus schools"
          diagram={<SingleDiagram />}
        />
        <ComparePanel
          id="compare-multi"
          icon={Building2}
          kicker="Multi-campus"
          title="One account, separate campuses"
          text="People who work at more than one campus choose where they are working. Their role, and the records they see, belong to that campus."
          facts={["A separate role at each campus", "Local sessions, fee rules and templates", "Switching never merges records"]}
          href="/solutions/multi-campus"
          linkLabel="Multi-campus groups"
          diagram={<MultiDiagram />}
        />
      </div>
    </Section>
  );
}

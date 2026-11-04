import { Sparkles } from "lucide-react";

import {
  AcademicsArt,
  AdmissionsArt,
  AiArt,
  ConsoleStage,
  DashboardsArt,
  DocumentsArt,
  DotsNetwork,
  EventStream,
  EventStreamSection,
  ExamsArt,
  FeesArt,
  NotebookSection,
  StudentPortalArt,
  WorkflowTabs,
  WorkflowTabsSection,
  peopleNodes,
} from "@/site/signature";
import { ButtonLink, ButtonRow } from "@/site/ui/button";
import { PageHero } from "@/site/ui/page-hero";
import { Section, SectionIntro } from "@/site/ui/section";

import type { Route } from "./+types/_site.kit";

/**
 * Internal component kit (`/kit`): renders every signature component in every
 * mode and variant so page authors can see them in place. Not linked, not in
 * the sitemap, and `noindex` (built here because `createMeta` has no `/kit`).
 */
export function meta({}: Route.MetaArgs) {
  return [
    { title: "Signature component kit | CampusPilot" },
    { name: "description", content: "Internal preview of the CampusPilot site's shared signature components." },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

const artworks = [
  ["AdmissionsArt", AdmissionsArt],
  ["FeesArt (billing)", FeesArt],
  ["ExamsArt", ExamsArt],
  ["DocumentsArt", DocumentsArt],
  ["AiArt", AiArt],
  ["AcademicsArt", AcademicsArt],
  ["DashboardsArt", DashboardsArt],
  ["StudentPortalArt", StudentPortalArt],
] as const;

/** Roles with a matching solution page get a link; Families and Students stay plain. */
const solutionLinks: Record<string, string> = {
  Principal: "/solutions/school-leaders",
  Management: "/solutions/multi-campus",
  Accounts: "/solutions/finance-teams",
  Teachers: "/solutions/teachers",
  "Exam cell": "/solutions/exam-teams",
  "Office staff": "/solutions/administrators",
};

const linkedPeople = peopleNodes.map((node) => ({ ...node, href: solutionLinks[node.label] }));

function KitBlock({ id, title, note, children }: { id: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <Section id={id} labelledBy={`${id}-title`}>
      <SectionIntro id={`${id}-title`} eyebrow="Kit" title={title} description={note} />
      {children}
    </Section>
  );
}

function ArtGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 440px), 1fr))", gap: 24 }}>
      {artworks.map(([name, Art]) => (
        <figure key={name} style={{ display: "flex", flexDirection: "column", gap: 10, margin: 0 }}>
          <figcaption style={{ font: "500 12px/1 var(--cp-mono)", color: "var(--cp-muted)" }}>{name}</figcaption>
          <Art />
        </figure>
      ))}
    </div>
  );
}

export default function KitPage() {
  return (
    <>
      <PageHero
        eyebrow="Internal kit"
        eyebrowIcon={Sparkles}
        title={<>Signature components<em>in every mode.</em></>}
        description="ConsoleStage is shown here as the PageHero visual, exactly as /product will use it."
        actions={
          <ButtonRow>
            <ButtonLink href="#workflows">Workflow tabs</ButtonLink>
            <ButtonLink href="#kit-dots-ai" tone="light">AI network</ButtonLink>
          </ButtonRow>
        }
        visual={<ConsoleStage />}
      />
      <WorkflowTabsSection />
      <KitBlock id="kit-tabs-widget" title="WorkflowTabs (widget only)" note="Same widget without its section intro.">
        <WorkflowTabs label="Workflows (second instance)" />
      </KitBlock>
      <KitBlock id="kit-art" title="Feature artworks" note="Each one works alone as a feature page hero visual; featureArt maps slugs to them.">
        <ArtGrid />
      </KitBlock>
      <KitBlock id="kit-hero-art" title="Artwork as hero visual" note="StudentPortalArt with a label, at roughly the width of the PageHero visual column.">
        <div style={{ maxWidth: 560, marginInline: "auto" }}>
          <StudentPortalArt label="A family's view showing only their own child's records" />
        </div>
      </KitBlock>
      <EventStreamSection id="kit-stream-full" eyebrow="EventStreamSection" variant="full" />
      <KitBlock id="kit-stream-compact" title="EventStream compact" note="Two lanes, shorter. Meant for home.">
        <EventStream variant="compact" />
      </KitBlock>
      <KitBlock id="kit-dots-people" title="DotsNetwork people" note="Nodes carry an href here, as on /solutions.">
        <DotsNetwork mode="people" nodes={linkedPeople} />
      </KitBlock>
      <KitBlock id="kit-dots-plain" title="DotsNetwork people (no links)" note="Default nodes, no hrefs.">
        <DotsNetwork mode="people" />
      </KitBlock>
      <KitBlock id="kit-dots-ai" title="DotsNetwork ai" note="Switch the role to see what that person's assistant can reach.">
        <DotsNetwork mode="ai" />
      </KitBlock>
      <NotebookSection />
      <NotebookSection
        id="kit-notebook-teachers"
        eyebrow="NotebookSection with role content"
        title="For teachers: the paperwork, done once."
        description="Same component, fed teacher-specific chores and chats, without the roadmap note."
        hideRoadmap
        leftKicker="a teacher's week"
        leftTitle="The registers you no longer copy."
        chores={[
          { chore: "Copy attendance from the register into a spreadsheet", how: "Mark attendance once; the class record and reports update." },
          { chore: "Total marks by hand for every student", how: "Enter marks for your subject; totals and grades follow." },
        ]}
        rightKicker="your assistant"
        rightTitle="Answers about your own classes only."
        chats={[
          { asker: "Class teacher, 8 A", question: "Who was absent three days in a row?", answer: "Ishaan R. and Sana K. in 8 A, from this week's attendance.", allowed: true },
          { asker: "Class teacher, 8 A", question: "What did 9 B score in Maths?", answer: "9 B isn't one of your classes, so I can't see its marks.", allowed: false },
        ]}
      />
    </>
  );
}

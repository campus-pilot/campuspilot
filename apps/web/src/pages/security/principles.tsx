import { BookOpenCheck, Bot, DoorOpen, Handshake, Scale, School, UserCog, type LucideIcon } from "lucide-react";

import { Section, SectionIntro } from "@/site/ui/section";

type Principle = { icon: LucideIcon; title: string; text: string; practice: string };

/** `securityItems` from the catalog, rewritten in plain language for school staff. */
const principles: readonly Principle[] = [
  {
    icon: School,
    title: "Each school is kept apart",
    text: "Every school's sessions, classes, students, staff, fee settings, templates and branding stay inside its own boundary.",
    practice: "One school, one boundary",
  },
  {
    icon: UserCog,
    title: "Access follows the job",
    text: "Administrators, managers, accountants, exam coordinators and teachers each get access shaped around their responsibilities.",
    practice: "Accounts sees fees, not marks",
  },
  {
    icon: BookOpenCheck,
    title: "Teachers work in their own classes",
    text: "Marks, attendance and exam work can be limited to the classes and sections each teacher is assigned.",
    practice: "8 A's teacher, 8 A's marks",
  },
  {
    icon: DoorOpen,
    title: "Students and families have their own door",
    text: "Student and family access is kept separate from staff access and only ever shows that student's own information.",
    practice: "Own child only",
  },
  {
    icon: Handshake,
    title: "Connections are deliberate",
    text: "People sign in to use CampusPilot. Any other tool or service connects only with your school's say-so, and only for what it is allowed to do.",
    practice: "Allowed by the school first",
  },
  {
    icon: Bot,
    title: "Assistants follow the same rules",
    text: "AI assistants are held to the same campus, role and class boundaries as the person using them.",
    practice: "No back door for AI",
  },
];

function PrincipleRow({ principle, index }: { principle: Principle; index: number }) {
  const Icon = principle.icon;
  return (
    <li className="pg-sec-rule">
      <span className="pg-sec-rule-num" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
      <span className="pg-sec-rule-icon" aria-hidden="true"><Icon /></span>
      <div className="pg-sec-rule-copy">
        <h3>{principle.title}</h3>
        <p>{principle.text}</p>
      </div>
      <p className="pg-sec-rule-practice"><span className="cp-sr-only">In practice: </span>{principle.practice}</p>
    </li>
  );
}

/**
 * The six security principles as a ruled register: number, icon, rule and an
 * "in practice" tag per row. Rows reveal with the scroll (CSS view timeline).
 */
export function PrinciplesSection() {
  return (
    <Section id="principles" labelledBy="pg-sec-principles-title" className="pg-sec-principles">
      <SectionIntro
        id="pg-sec-principles-title"
        eyebrow="Principles"
        eyebrowIcon={Scale}
        title="Six rules that hold everywhere."
        description="The same rules apply on every screen, for every person, and for every assistant working on someone's behalf."
      />
      <ol className="pg-sec-register">
        {principles.map((principle, index) => <PrincipleRow key={principle.title} principle={principle} index={index} />)}
      </ol>
    </Section>
  );
}

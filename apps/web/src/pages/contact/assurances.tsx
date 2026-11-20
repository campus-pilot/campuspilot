import { Handshake, School, ShieldCheck, type LucideIcon } from "lucide-react";

const assurances: readonly [LucideIcon, string, string][] = [
  [Handshake, "No obligation", "A conversation, not a commitment. Decide in your own time."],
  [School, "Tailored to your school", "Your classes, fee heads and exam pattern, not a generic tour."],
  [ShieldCheck, "Your data stays your school's", "Records belong to your school, and access follows each person's role."],
];

function Assurance({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <li>
      <span className="pg-book-assure-icon" aria-hidden="true">
        <Icon />
      </span>
      <span className="pg-book-assure-text">
        <b>{title}</b>
        <small>{text}</small>
      </span>
    </li>
  );
}

/** What a school can expect from the demo, right under the request form. */
export function AssuranceSection() {
  return (
    <section className="cp-section pg-book-assure-band" aria-label="What to expect">
      <ul className="pg-book-assure">
        {assurances.map(([icon, title, text]) => (
          <Assurance key={title} icon={icon} title={title} text={text} />
        ))}
      </ul>
    </section>
  );
}

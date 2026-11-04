import { CalendarClock, Clock, ExternalLink, Handshake, School, ShieldCheck, type LucideIcon } from "lucide-react";

import { Section, SectionIntro } from "@/site/ui/section";
import { calendarUrl } from "@/pages/contact-channels/channels";

function CalendarBar() {
  return (
    <div className="pg-book-cal-bar">
      <span className="pg-book-cal-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <b>CampusPilot demo</b>
      <span className="pg-book-cal-meta">
        <Clock aria-hidden="true" /> 30 min
      </span>
    </div>
  );
}

/**
 * The scheduler is a third-party page from `VITE_CALENDAR_URL`. Some networks,
 * browsers or privacy extensions block embedded calendars, so the same URL is
 * always offered as a plain new-tab link under the frame.
 */
function CalendarFallback() {
  return (
    <p className="pg-book-cal-foot">
      Calendar not loading, or too small on your screen?{" "}
      <a className="cp-text-link" href={calendarUrl} target="_blank" rel="noreferrer">
        Open the scheduler in a new tab <ExternalLink aria-hidden="true" />
      </a>
    </p>
  );
}

/** Window-style frame around the embedded scheduling page (the page's main action). */
function CalendarFrame() {
  return (
    <div className="pg-book-cal">
      <CalendarBar />
      <div className="pg-book-cal-body">
        <iframe title="Schedule a CampusPilot demo" src={calendarUrl} loading="lazy" />
      </div>
      <CalendarFallback />
    </div>
  );
}

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

function ReassuranceStrip() {
  return (
    <ul className="pg-book-assure" aria-label="What to expect">
      {assurances.map(([icon, title, text]) => (
        <Assurance key={title} icon={icon} title={title} text={text} />
      ))}
    </ul>
  );
}

/** Anchor target of the hero's "Pick a time" button. */
export function SchedulerSection() {
  return (
    <Section id="schedule" labelledBy="pg-book-schedule-title" className="pg-book-schedule">
      <SectionIntro
        id="pg-book-schedule-title"
        eyebrow="Schedule"
        eyebrowIcon={CalendarClock}
        title="Pick a time that suits your school day."
        description="Choose any open slot below. Bring whoever runs admissions, fees or exams; the walkthrough is built for the people who do the work."
      />
      <CalendarFrame />
      <ReassuranceStrip />
    </Section>
  );
}

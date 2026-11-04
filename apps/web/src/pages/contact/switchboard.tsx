import { ArrowRight, CalendarDays, LogIn, Signpost, type LucideIcon } from "lucide-react";
import { Link } from "react-router";

import { LoginButton } from "@/site/shell/login-dialog";
import { Section, SectionIntro } from "@/site/ui/section";
import { channelTarget, channels, type ChannelId } from "@/pages/contact-channels/channels";

/** Where a need is routed: one of the env channels, a page on this site, or the login dialog. */
type PageTarget = {
  kind: "page";
  href: string;
  label: string;
  icon: LucideIcon;
  /** Renders the destination as the dark, emphasised tile. */
  emphasis?: boolean;
};

/** Opens the shared staff/student login dialog instead of navigating. */
type LoginTarget = { kind: "login" };

type RouteTarget = { kind: "channel"; id: ChannelId } | PageTarget | LoginTarget;

type ContactRoute = {
  need: string;
  example: string;
  target: RouteTarget;
};

const routes: readonly ContactRoute[] = [
  {
    need: "A quick question",
    example: "“Does it handle our fee heads?” “Can two campuses share one setup?”",
    target: { kind: "channel", id: "whatsapp" },
  },
  {
    need: "You'd rather talk it through",
    example: "With the principal or owner on the line, in your own words.",
    target: { kind: "channel", id: "phone" },
  },
  {
    need: "Detailed requirements",
    example: "Campuses, classes and sections, fee structure, exam pattern, current tools.",
    target: { kind: "channel", id: "email" },
  },
  {
    need: "You want to see it working",
    example: "A 30-minute walkthrough with your sessions, fees and exams in mind.",
    target: { kind: "page", href: "/book-demo", label: "Book a demo", icon: CalendarDays, emphasis: true },
  },
  {
    need: "You already use CampusPilot",
    example: "Staff sign in to their school's workspace.",
    target: { kind: "login" },
  },
];

function ChannelTargetLink({ id }: { id: ChannelId }) {
  const channel = channels[id];
  const Icon = channel.icon;
  return (
    <a className="pg-contact-target" data-channel={id} href={channel.href} {...channelTarget(channel)}>
      <Icon aria-hidden="true" />
      <span className="pg-contact-target-text">
        <b>{channel.name}</b>
        <small>{channel.value}</small>
      </span>
      {channel.external ? <span className="pg-cc-sr"> (opens in a new tab)</span> : null}
    </a>
  );
}

function PageTargetLink({ target }: { target: PageTarget }) {
  const Icon = target.icon;
  return (
    <Link className="pg-contact-target" data-page data-emphasis={target.emphasis || undefined} to={target.href}>
      <Icon aria-hidden="true" />
      <span className="pg-contact-target-text">
        <b>{target.label}</b>
      </span>
      <ArrowRight className="pg-contact-target-arrow" aria-hidden="true" />
    </Link>
  );
}

function LoginTargetButton() {
  return (
    <LoginButton className="pg-contact-target">
      <LogIn aria-hidden="true" />
      <span className="pg-contact-target-text">
        <b>Log in</b>
      </span>
      <ArrowRight className="pg-contact-target-arrow" aria-hidden="true" />
    </LoginButton>
  );
}

function RouteTargetLink({ target }: { target: RouteTarget }) {
  if (target.kind === "channel") return <ChannelTargetLink id={target.id} />;
  if (target.kind === "login") return <LoginTargetButton />;
  return <PageTargetLink target={target} />;
}

/** One need on the left, wired to the right destination; a pulse runs along the wire. */
function RouteRow({ route, index }: { route: ContactRoute; index: number }) {
  return (
    <li className="pg-contact-route" style={{ "--pg-i": index } as React.CSSProperties}>
      <span className="pg-contact-need">
        <b>{route.need}</b>
        <small>{route.example}</small>
      </span>
      <span className="pg-contact-wire" aria-hidden="true">
        <i />
      </span>
      <RouteTargetLink target={route.target} />
    </li>
  );
}

/** "Which channel for what": a switchboard that routes each kind of need to a channel or page. */
export function SwitchboardSection() {
  return (
    <Section id="which-channel" labelledBy="pg-contact-switch-title" className="pg-contact-switch">
      <SectionIntro
        id="pg-contact-switch-title"
        eyebrow="Which channel for what"
        eyebrowIcon={Signpost}
        title="Match the channel to the question."
        description="Not sure where to start? A simple guide to the quickest route for what you need."
      />
      <ol className="pg-contact-board">
        {routes.map((route, index) => (
          <RouteRow key={route.need} route={route} index={index} />
        ))}
      </ol>
    </Section>
  );
}

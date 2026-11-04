import { CalendarDays, Compass, House, LayoutGrid, Signpost, UsersRound, type LucideIcon } from "lucide-react";
import { Link, useLocation } from "react-router";

import { ButtonLink, ButtonRow } from "@/site/ui/button";
import { FinalCta } from "@/site/ui/final-cta";
import { PageHero } from "@/site/ui/page-hero";
import { Section, SectionIntro } from "@/site/ui/section";

const signposts: readonly [string, LucideIcon, string, string][] = [
  ["/", House, "Home", "What CampusPilot does for your school."],
  ["/features", LayoutGrid, "Features", "Admissions, fees, exams, documents and more."],
  ["/solutions", UsersRound, "Solutions", "For leaders, office teams, teachers and groups."],
  ["/book-demo", CalendarDays, "Book a demo", "A 30-minute walkthrough for your school."],
];

function SignpostLink({ href, icon: Icon, title, text }: { href: string; icon: LucideIcon; title: string; text: string }) {
  return (
    <li>
      <Link className="pg-util-sign" to={href}>
        <span className="pg-util-sign-icon" aria-hidden="true">
          <Icon />
        </span>
        <b>{title}</b>
        <span>{text}</span>
      </Link>
    </li>
  );
}

function Signposts() {
  return (
    <Section id="signposts" labelledBy="pg-util-signs-title">
      <SectionIntro id="pg-util-signs-title" eyebrow="Try one of these" eyebrowIcon={Signpost} title="Where would you like to go?" />
      <ul className="pg-util-signs">
        {signposts.map(([href, icon, title, text]) => (
          <SignpostLink key={href} href={href} icon={icon} title={title} text={text} />
        ))}
      </ul>
    </Section>
  );
}

/**
 * Site-shell 404 for any unknown URL. Shows the requested path so a mistyped
 * link is easy to spot. The site is a static SPA, so no HTTP status is set
 * here; the page is marked noindex through `createMeta("/404")`.
 */
export function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <>
      <PageHero
        eyebrow="404 · Page not found"
        eyebrowIcon={Compass}
        title={
          <>
            This page isn't here. <em>Let's find the right one.</em>
          </>
        }
        description={
          <>
            Nothing lives at <code className="pg-util-path-code">{pathname}</code>. It may have moved, or the link may have a
            typo.
          </>
        }
        actions={
          <ButtonRow>
            <ButtonLink href="/" size="lg">
              Back to home
            </ButtonLink>
            <ButtonLink href="/book-demo" size="lg" tone="light">
              Book a demo
            </ButtonLink>
          </ButtonRow>
        }
      />
      <Signposts />
      <FinalCta />
    </>
  );
}

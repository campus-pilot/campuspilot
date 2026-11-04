import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import { ScribbleCircle, revealOnView } from "./doodles";
import { navGroups, plainNavLinks } from "./nav-data";

function FooterCta() {
  return (
    <div className="d3-footer-cta" ref={revealOnView}>
      <h2>
        Ready to connect your school's <span className="d3-nowrap"><span className="d3-circled">dots<ScribbleCircle /></span>?</span>
      </h2>
      <p>See CampusPilot with a school like yours — from the first enquiry to the last report card.</p>
      <div className="d3-hero-actions">
        <Link to="/book-demo" className="d3-btn d3-btn-marker d3-btn-lg">
          Book a demo <ArrowRight aria-hidden="true" />
        </Link>
        <Link to="/login" className="d3-btn d3-btn-paper d3-btn-lg">Log in</Link>
      </div>
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: readonly { href: string; label: string }[] }) {
  return (
    <div className="d3-footer-col">
      <h3 className="d3-hand">{title}</h3>
      <ul>
        {links.map((link) => <li key={link.href}><Link to={link.href}>{link.label}</Link></li>)}
      </ul>
    </div>
  );
}

function FooterBase() {
  return (
    <div className="d3-footer-base">
      <span className="d3-brand d3-brand-static">
        <img src="/icon.svg" alt="" width={28} height={28} />
        <span>CampusPilot</span>
      </span>
      <p>© 2026 CampusPilot · Made for schools in India</p>
      <p className="d3-hand">School names and numbers on this page are illustrative.</p>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="d3-footer">
      <div className="d3-wrap">
        <FooterCta />
        <nav className="d3-footer-nav" aria-label="Footer">
          {navGroups.map((group) => <FooterColumn key={group.id} title={group.label} links={group.links} />)}
          <FooterColumn title="Company" links={[...plainNavLinks, { href: "/login", label: "Log in" }, { href: "/book-demo", label: "Book a demo" }]} />
        </nav>
        <FooterBase />
      </div>
    </footer>
  );
}

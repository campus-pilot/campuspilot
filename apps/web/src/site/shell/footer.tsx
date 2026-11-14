import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import { navMenus } from "./nav-data";
import { BrandMark } from "./navbar";

function FooterColumn({ title, links }: { title: string; links: readonly { href: string; label: string }[] }) {
  return (
    <div className="cp-footer-col">
      <p>{title}</p>
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <Link to={link.href}>{link.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FooterBrand() {
  return (
    <div className="cp-footer-brand">
      <BrandMark />
      <p>The connected school operating system for schools in India — admin done once, records ready for AI.</p>
      <Link className="cp-btn cp-btn-primary cp-btn-sm" to="/book-demo">
        Book a demo <ArrowRight aria-hidden="true" />
      </Link>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="cp-footer">
      <div className="cp-footer-grid">
        <FooterBrand />
        {navMenus.map((menu) => (
          <FooterColumn key={menu.id} title={menu.label} links={menu.groups.flatMap((group) => group.items)} />
        ))}
      </div>
      <div className="cp-footer-base">
        <small>© 2026 CampusPilot</small>
        <nav className="cp-footer-legal" aria-label="Legal">
          <Link to="/privacy">Privacy policy</Link>
          <Link to="/terms">Terms of use</Link>
        </nav>
        <small>Made for schools in India</small>
      </div>
    </footer>
  );
}

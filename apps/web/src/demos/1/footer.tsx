import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import { navMenus } from "./nav-data";
import { BrandMark } from "./navbar";

function FooterColumn({ title, links }: { title: string; links: readonly { href: string; label: string }[] }) {
  return (
    <div className="d1-footer-col">
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
    <div className="d1-footer-brand">
      <BrandMark />
      <p>The connected school operating system for schools in India — admin done once, records ready for AI.</p>
      <Link className="d1-btn d1-btn-dark d1-btn-sm" to="/book-demo">
        Book a demo <ArrowRight aria-hidden="true" />
      </Link>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="d1-footer">
      <div className="d1-footer-grid">
        <FooterBrand />
        {navMenus.map((menu) => (
          <FooterColumn key={menu.id} title={menu.label} links={menu.groups.flatMap((group) => group.items)} />
        ))}
      </div>
      <div className="d1-footer-base">
        <small>© 2026 CampusPilot</small>
        <small>Made for schools in India</small>
      </div>
    </footer>
  );
}

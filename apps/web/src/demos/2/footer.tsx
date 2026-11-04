import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import { BrandMark } from "./brand";
import { productLinks, solutionLinks } from "./nav-data";

const companyLinks = [
  { href: "/ai-ready", label: "AI-ready" },
  { href: "/security", label: "Security" },
  { href: "/book-demo", label: "Book a demo" },
  { href: "/login", label: "Log in" },
] as const;

export function Footer() {
  return (
    <footer className="d2-footer">
      <div className="d2-container">
        <FooterCta />
        <div className="d2-footer-grid">
          <FooterBrand />
          <FooterColumn title="Product" links={productLinks} />
          <FooterColumn title="Solutions" links={solutionLinks} />
          <FooterColumn title="CampusPilot" links={companyLinks} />
        </div>
        <p className="d2-footer-base">
          <span>© 2026 CampusPilot. School management software for India.</span>
          <span>Product views on this page use illustrative data.</span>
        </p>
      </div>
    </footer>
  );
}

function FooterCta() {
  return (
    <div className="d2-footer-cta">
      <p><b>See your school's repeated work disappear.</b><span>A walkthrough shaped around your own admissions, fees and exam work.</span></p>
      <Link className="d2-btn d2-btn-primary d2-btn-lg" to="/book-demo">
        Book a demo <ArrowRight aria-hidden="true" />
      </Link>
    </div>
  );
}

function FooterBrand() {
  return (
    <div className="d2-footer-brand">
      <Link to="/2" className="d2-brand" aria-label="CampusPilot home"><BrandMark /></Link>
      <p>The connected school operating system — admissions, academics, fees, examinations and documents in one place, ready for AI.</p>
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: readonly { href: string; label: string }[] }) {
  return (
    <nav className="d2-footer-col" aria-label={title}>
      <h2>{title}</h2>
      <ul>
        {links.map((link) => <li key={link.href}><Link to={link.href}>{link.label}</Link></li>)}
      </ul>
    </nav>
  );
}

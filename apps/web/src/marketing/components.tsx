import { BrandLogo } from "@campuspilot/components/brand-logo";
import { ArrowRight, Sparkles } from "lucide-react";
import { Link } from "react-router";

export function SectionIntro({ eyebrow, title, accent, description }: { eyebrow: string; title: string; accent?: string; description?: string }) {
  return (
    <div className="section-intro">
      <span className="section-index">{eyebrow}</span>
      <div><h2>{title}{accent && <><br /><em>{accent}</em></>}</h2>{description && <p>{description}</p>}</div>
    </div>
  );
}

export function FinalCta() {
  return (
    <section className="final-cta">
      <div className="marketing-container final-cta-inner">
        <span className="final-cta-icon"><Sparkles aria-hidden="true" /></span>
        <div><small>SEE CAMPUSPILOT IN ACTION</small><h2>A calmer way to run your school.</h2><p>We’ll focus the walkthrough on the workflows that matter to you.</p></div>
        <div><Link className="marketing-button marketing-button-light" to="/book-demo">Book a demo <ArrowRight /></Link><Link className="marketing-button marketing-button-outline-light" to="/login">Log in</Link></div>
      </div>
    </section>
  );
}

const footerLinks = [
  ["Platform", [["Overview", "/product"], ["Features", "/features"], ["AI ready", "/ai-ready"], ["Security", "/security"]]],
  ["Workflows", [["Admissions", "/features/admissions"], ["Billing", "/features/billing"], ["Examinations", "/features/examinations"], ["Documents", "/features/documents"]]],
  ["Company", [["For schools", "/solutions"], ["Book a demo", "/book-demo"], ["Contact", "/contact"], ["Log in", "/login"]]],
] as const;

export function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <div className="marketing-container footer-grid">
        <div className="footer-brand"><Link to="/" aria-label="CampusPilot home"><BrandLogo product="campuspilot" /></Link><p>The connected school operating system built for modern teams—and ready for the AI era.</p></div>
        {footerLinks.map(([heading, links]) => <div key={heading}><b>{heading}</b>{links.map(([label, href]) => <Link key={href} to={href}>{label}</Link>)}</div>)}
      </div>
      <div className="marketing-container footer-bottom"><span>© 2026 CampusPilot</span><span>Designed for modern schools in India.</span></div>
    </footer>
  );
}

import { BrandLogo } from "@campuspilot/components/brand-logo";
import { ThemeToggle } from "@campuspilot/components/theme-toggle";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  ChevronDown,
  CreditCard,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Library,
  Menu,
  School,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Link } from "react-router";

type MenuLink = {
  description: string;
  href: string;
  icon: typeof School;
  label: string;
};

const productLinks: readonly MenuLink[] = [
  { href: "/product", label: "CampusPilot", description: "The connected school operating system", icon: School },
  { href: "/features/admissions", label: "Admissions", description: "Enquiries to active student records", icon: Users },
  { href: "/features/academics", label: "Academics", description: "Sessions, classes, subjects, and teachers", icon: GraduationCap },
  { href: "/features/billing", label: "Finance & billing", description: "Bills, payments, receipts, and ledgers", icon: CreditCard },
  { href: "/features/examinations", label: "Examinations", description: "Plans, timetables, results, and approvals", icon: BookOpen },
  { href: "/features/documents", label: "Documents", description: "Branded outputs from live records", icon: FileText },
  { href: "/features/dashboards", label: "Dashboards", description: "Operational signals in context", icon: LayoutDashboard },
  { href: "/security", label: "Security", description: "Role, campus, and assignment boundaries", icon: ShieldCheck },
];

const solutionLinks: readonly MenuLink[] = [
  { href: "/solutions/school-leaders", label: "School leaders", description: "A connected view of the whole school", icon: BarChart3 },
  { href: "/solutions/administrators", label: "Administrators", description: "Keep daily operations moving", icon: LayoutDashboard },
  { href: "/solutions/teachers", label: "Teachers", description: "Focused work for assigned classrooms", icon: GraduationCap },
  { href: "/solutions/finance-teams", label: "Finance teams", description: "Trace every amount and balance", icon: CreditCard },
  { href: "/solutions/exam-teams", label: "Examination teams", description: "Control the complete exam lifecycle", icon: BookOpen },
  { href: "/solutions/single-campus", label: "Single-campus schools", description: "One dependable source of truth", icon: School },
  { href: "/solutions/multi-campus", label: "Multi-campus groups", description: "Grow without blurring boundaries", icon: Building2 },
];

const resourceLinks: readonly MenuLink[] = [
  { href: "/solutions", label: "For schools", description: "Explore CampusPilot by team and institution", icon: School },
  { href: "/ai-ready", label: "AI ready", description: "Permission-aware workflows through MCP", icon: Bot },
  { href: "/documentation", label: "Documentation", description: "Product guidance — coming soon", icon: Library },
];

function closeMenu(event: React.MouseEvent<HTMLAnchorElement>) {
  event.currentTarget.closest("details")?.removeAttribute("open");
  event.currentTarget.closest(".marketing-mobile-menu")?.removeAttribute("open");
}

/** Opens desktop mega menus without requiring a click, while keeping details keyboard-operable. */
function openDesktopMenu(event: React.MouseEvent<HTMLDetailsElement> | React.FocusEvent<HTMLDetailsElement>) {
  event.currentTarget.open = true;
}

/** Closes a keyboard-opened menu only after focus leaves the whole menu surface. */
function closeDesktopMenuOnBlur(event: React.FocusEvent<HTMLDetailsElement>) {
  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
    event.currentTarget.open = false;
  }
}

function MenuItems({ links }: { links: readonly MenuLink[] }) {
  return (
    <div className="nav-menu-grid">
      {links.map(({ href, label, description, icon: Icon }) => (
        <Link key={href} to={href} onClick={closeMenu}>
          <Icon aria-hidden="true" />
          <span><b>{label}</b><small>{description}</small></span>
          <ArrowRight aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}

function DesktopMenu({ label, links, wide = false }: { label: string; links: readonly MenuLink[]; wide?: boolean }) {
  return (
    <details
      className={`nav-menu ${wide ? "is-wide" : ""}`}
      onBlur={closeDesktopMenuOnBlur}
      onFocus={openDesktopMenu}
      onMouseEnter={openDesktopMenu}
      onMouseLeave={(event) => { event.currentTarget.open = false; }}
    >
      <summary>{label}<ChevronDown aria-hidden="true" /></summary>
      <div className="nav-menu-popover"><MenuItems links={links} /></div>
    </details>
  );
}

function MobileNavigation() {
  return (
    <nav className="marketing-mobile-nav" aria-label="Mobile navigation">
      <details><summary>Product <ChevronDown /></summary><MenuItems links={productLinks} /></details>
      <details><summary>Solutions <ChevronDown /></summary><MenuItems links={solutionLinks} /></details>
      <details><summary>Resources <ChevronDown /></summary><MenuItems links={resourceLinks} /></details>
      <div className="marketing-mobile-actions">
        <Link className="marketing-mobile-login" to="/login" onClick={closeMenu}>Log in</Link>
        <Link className="marketing-mobile-demo" to="/book-demo" onClick={closeMenu}>Book a demo <ArrowRight /></Link>
      </div>
    </nav>
  );
}

export default function Header() {
  return (
    <header className="marketing-header">
      <div className="marketing-container marketing-header-inner">
        <Link to="/" aria-label="CampusPilot home" className="marketing-brand"><BrandLogo size="sm" /></Link>
        <nav className="marketing-nav" aria-label="Main navigation">
          <DesktopMenu label="Product" links={productLinks} wide />
          <DesktopMenu label="Solutions" links={solutionLinks} wide />
          <DesktopMenu label="Resources" links={resourceLinks} />
        </nav>
        <div className="marketing-header-actions">
          <ThemeToggle />
          <Link className="marketing-login" to="/login">Log in</Link>
          <Link className="marketing-button marketing-button-dark marketing-header-cta" to="/book-demo">Book a demo <ArrowRight /></Link>
          <details className="marketing-mobile-menu"><summary aria-label="Open navigation"><Menu aria-hidden="true" /></summary><MobileNavigation /></details>
        </div>
      </div>
    </header>
  );
}

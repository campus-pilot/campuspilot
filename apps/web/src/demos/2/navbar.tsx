import { ArrowRight, ChevronDown, Menu, Sparkles, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Link } from "react-router";

import { BrandMark } from "./brand";
import { type NavLink, type NavMenu, navMenus, navPlainLinks } from "./nav-data";

/** Distance in px after which the bar condenses into the floating variant. */
const SCROLL_THRESHOLD = 16;

function subscribeToScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

/**
 * Reads the scroll position as an external store instead of syncing it through an effect.
 * The server snapshot is `false`, so SSR always renders the transparent "at top" bar.
 */
function useScrolled() {
  return useSyncExternalStore(
    subscribeToScroll,
    () => window.scrollY > SCROLL_THRESHOLD,
    () => false,
  );
}

export function Navbar() {
  const scrolled = useScrolled();
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <header className="d2-nav" data-scrolled={scrolled} data-mobile-open={mobileOpen}>
      <div className="d2-nav-bar">
        <Link to="/2" className="d2-brand" aria-label="CampusPilot home">
          <BrandMark />
        </Link>
        <DesktopNav />
        <NavActions />
        <MobileToggle open={mobileOpen} onToggle={() => setMobileOpen((open) => !open)} />
      </div>
      <MobileMenu open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </header>
  );
}

function NavActions() {
  return (
    <div className="d2-nav-actions">
      <Link className="d2-nav-login" to="/login">Log in</Link>
      <Link className="d2-btn d2-btn-primary d2-btn-sm" to="/book-demo">
        Book a demo <ArrowRight aria-hidden="true" />
      </Link>
    </div>
  );
}

function DesktopNav() {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <nav className="d2-nav-links" aria-label="Main">
      <ul className="d2-nav-list">
        {navMenus.map((menu) => (
          <DesktopMenu
            key={menu.id}
            menu={menu}
            open={openId === menu.id}
            onOpenChange={(open) => setOpenId(open ? menu.id : null)}
          />
        ))}
        {navPlainLinks.map((link) => <PlainNavItem key={link.href} link={link} />)}
      </ul>
    </nav>
  );
}

function PlainNavItem({ link }: { link: NavLink }) {
  const Icon = link.label === "AI-ready" ? Sparkles : link.icon;
  return (
    <li>
      <Link className="d2-nav-trigger" to={link.href}>
        <Icon className="d2-nav-trigger-icon" aria-hidden="true" />
        {link.label}
      </Link>
    </li>
  );
}

/**
 * Hover opens the menu for pointer users; the trigger button toggles it for keyboard users.
 * Mouse clicks (`detail > 0`) only ever open, so a hover-opened menu is not closed by the
 * click that naturally follows. Focus leaving the item or Escape closes it.
 */
function DesktopMenu({
  menu,
  open,
  onOpenChange,
}: {
  menu: NavMenu;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const panelId = `d2-menu-${menu.id}`;
  return (
    <li
      className="d2-menu"
      data-open={open}
      onMouseEnter={() => onOpenChange(true)}
      onMouseLeave={() => onOpenChange(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onOpenChange(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        onOpenChange(false);
        event.currentTarget.querySelector("button")?.focus();
      }}
    >
      <button
        type="button"
        className="d2-nav-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(event) => onOpenChange(event.detail === 0 ? !open : true)}
      >
        {menu.label}
        <ChevronDown className="d2-chevron" aria-hidden="true" />
      </button>
      <div className="d2-menu-pop" id={panelId}>
        <MenuPanel menu={menu} onNavigate={() => onOpenChange(false)} />
      </div>
    </li>
  );
}

function MenuPanel({ menu, onNavigate }: { menu: NavMenu; onNavigate: () => void }) {
  return (
    <div className="d2-menu-panel">
      <ul className="d2-menu-grid">
        {menu.links.map((link) => (
          <li key={link.href}>
            <MenuLink link={link} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
      <MenuFeature menuId={menu.id} onNavigate={onNavigate} />
    </div>
  );
}

/** Icon tile animates on hover/focus through the `.d2-menu-link:hover .d2-icon-tile` rules. */
function MenuLink({ link, onNavigate }: { link: NavLink; onNavigate: () => void }) {
  const Icon = link.icon;
  return (
    <Link className="d2-menu-link" to={link.href} onClick={onNavigate}>
      <span className="d2-icon-tile"><Icon aria-hidden="true" /></span>
      <span className="d2-menu-text">
        <b>{link.label}</b>
        <small>{link.description}</small>
      </span>
    </Link>
  );
}

function MenuFeature({ menuId, onNavigate }: { menuId: string; onNavigate: () => void }) {
  const isProduct = menuId === "product";
  return (
    <Link className="d2-menu-feature" to={isProduct ? "/ai-ready" : "/solutions"} onClick={onNavigate}>
      <span className="d2-menu-feature-tag">{isProduct ? "AI-ready" : "Built for India"}</span>
      <b>{isProduct ? "Answers from live records, permissions intact." : "Sessions, sections and ₹ ledgers, out of the box."}</b>
      <small>
        {isProduct
          ? "Works with the AI assistants your team already uses."
          : "From Nursery to Class 12, one campus or a group."}
      </small>
      <span className="d2-menu-feature-cta">Learn more <ArrowRight aria-hidden="true" /></span>
    </Link>
  );
}

function MobileToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      id="d2-mobile-toggle"
      className="d2-mobile-toggle"
      aria-expanded={open}
      aria-controls="d2-mobile-menu"
      aria-label={open ? "Close menu" : "Open menu"}
      onClick={onToggle}
    >
      {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
    </button>
  );
}

function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div
      className="d2-mobile"
      id="d2-mobile-menu"
      hidden={!open}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        onClose();
        document.getElementById("d2-mobile-toggle")?.focus();
      }}
    >
      <nav className="d2-mobile-nav" aria-label="Mobile">
        {navMenus.map((menu) => <MobileGroup key={menu.id} menu={menu} onNavigate={onClose} />)}
        {navPlainLinks.map((link) => (
          <Link key={link.href} className="d2-mobile-plain" to={link.href} onClick={onClose}>
            {link.label} <ArrowRight aria-hidden="true" />
          </Link>
        ))}
      </nav>
      <div className="d2-mobile-actions">
        <Link className="d2-btn d2-btn-ghost" to="/login" onClick={onClose}>Log in</Link>
        <Link className="d2-btn d2-btn-primary" to="/book-demo" onClick={onClose}>
          Book a demo <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function MobileGroup({ menu, onNavigate }: { menu: NavMenu; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const listId = `d2-mobile-${menu.id}`;
  return (
    <div className="d2-mobile-group" data-open={open}>
      <button
        type="button"
        className="d2-mobile-group-trigger"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        {menu.label}
        <ChevronDown className="d2-chevron" aria-hidden="true" />
      </button>
      <ul className="d2-mobile-list" id={listId} hidden={!open}>
        {menu.links.map((link) => (
          <li key={link.href}>
            <MenuLink link={link} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </div>
  );
}

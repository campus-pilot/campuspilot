import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Link } from "react-router";

import { Squiggle, Tape } from "./doodles";
import { navGroups, plainNavLinks, type NavGroup, type NavLinkItem } from "./nav-data";

function subscribeToScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

/**
 * Whether the page has scrolled past the hero's first few pixels.
 * Read through `useSyncExternalStore` (no effect) so the header can swap from
 * the open "page heading" look to the compact taped paper strip.
 */
function useScrolled(threshold = 12) {
  return useSyncExternalStore(
    subscribeToScroll,
    () => window.scrollY > threshold,
    () => false,
  );
}

/**
 * Open/close state for the desktop dropdowns. Only one menu is open at a time.
 * Mouse pointers open on hover (like cal.com); touch and pen rely on the click
 * toggle so a tap does not open-then-immediately-close a menu.
 */
function useDropdowns() {
  const [openId, setOpenId] = useState<string | null>(null);
  return {
    openId,
    toggle: (id: string) => setOpenId((current) => (current === id ? null : id)),
    hoverOpen: (event: React.PointerEvent, id: string) => {
      if (event.pointerType === "mouse") setOpenId(id);
    },
    hoverClose: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") setOpenId(null);
    },
    close: () => setOpenId(null),
  };
}

type Dropdowns = ReturnType<typeof useDropdowns>;

function Brand() {
  return (
    <Link to="/3" className="d3-brand" aria-label="CampusPilot home">
      <img src="/icon.svg" alt="" width={34} height={34} />
      <span>CampusPilot</span>
    </Link>
  );
}

function DropdownLink({ link, onNavigate }: { link: NavLinkItem; onNavigate: () => void }) {
  const Icon = link.icon;
  return (
    <Link to={link.href} className="d3-drop-link" onClick={onNavigate}>
      <span className="d3-doodle-icon"><Icon aria-hidden="true" strokeWidth={1.8} /></span>
      <span className="d3-drop-text">
        <b>{link.label}</b>
        <small>{link.description}</small>
      </span>
    </Link>
  );
}

function DropdownPanel({ group, open, onNavigate }: { group: NavGroup; open: boolean; onNavigate: () => void }) {
  return (
    <div id={`d3-menu-${group.id}`} className="d3-drop" data-open={open}>
      <div className="d3-drop-card">
        <Tape className="d3-tape-top" />
        <ul className="d3-drop-grid">
          {group.links.map((link) => (
            <li key={link.href}><DropdownLink link={link} onNavigate={onNavigate} /></li>
          ))}
        </ul>
        <p className="d3-drop-note">{group.note}</p>
      </div>
    </div>
  );
}

/** Closes the menu when focus leaves the trigger + panel pair; Escape returns focus to the trigger. */
function DropdownItem({ group, menus }: { group: NavGroup; menus: Dropdowns }) {
  const open = menus.openId === group.id;
  return (
    <li
      className="d3-nav-item"
      onPointerEnter={(event) => menus.hoverOpen(event, group.id)}
      onPointerLeave={menus.hoverClose}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) menus.close();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        menus.close();
        event.currentTarget.querySelector("button")?.focus();
      }}
    >
      <button
        type="button"
        className="d3-nav-trigger"
        aria-expanded={open}
        aria-controls={`d3-menu-${group.id}`}
        onClick={() => menus.toggle(group.id)}
      >
        <span className="d3-nav-label">{group.label}<Squiggle /></span>
        <ChevronDown aria-hidden="true" className="d3-chevron" />
      </button>
      <DropdownPanel group={group} open={open} onNavigate={menus.close} />
    </li>
  );
}

function DesktopNav() {
  const menus = useDropdowns();
  return (
    <nav className="d3-nav" aria-label="Main">
      <ul className="d3-nav-list">
        {navGroups.map((group) => <DropdownItem key={group.id} group={group} menus={menus} />)}
        {plainNavLinks.map((link) => (
          <li key={link.href} className="d3-nav-item">
            <Link to={link.href} className="d3-nav-trigger">
              <span className="d3-nav-label">{link.label}<Squiggle /></span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function HeaderActions() {
  return (
    <div className="d3-header-actions">
      <Link to="/login" className="d3-login">Log in<Squiggle /></Link>
      <Link to="/book-demo" className="d3-btn d3-btn-marker d3-header-cta">
        Book a demo <ArrowRight aria-hidden="true" />
      </Link>
    </div>
  );
}

function MobileGroup({ title, links, onNavigate }: { title: string; links: readonly NavLinkItem[]; onNavigate: () => void }) {
  return (
    <section className="d3-sheet-group" aria-label={title}>
      <h2>{title}</h2>
      <ul>
        {links.map((link) => <li key={link.href}><DropdownLink link={link} onNavigate={onNavigate} /></li>)}
      </ul>
    </section>
  );
}

function MobileSheet({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  return (
    <div id="d3-mobile-sheet" className="d3-sheet" data-open={open}>
      {navGroups.map((group) => <MobileGroup key={group.id} title={group.label} links={group.links} onNavigate={onNavigate} />)}
      <MobileGroup title="More" links={plainNavLinks} onNavigate={onNavigate} />
      <div className="d3-sheet-actions">
        <Link to="/login" className="d3-btn d3-btn-paper" onClick={onNavigate}>Log in</Link>
        <Link to="/book-demo" className="d3-btn d3-btn-marker" onClick={onNavigate}>Book a demo <ArrowRight aria-hidden="true" /></Link>
      </div>
    </div>
  );
}

function MobileToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const Icon = open ? X : Menu;
  return (
    <button
      type="button"
      className="d3-menu-toggle"
      aria-expanded={open}
      aria-controls="d3-mobile-sheet"
      aria-label={open ? "Close menu" : "Open menu"}
      onClick={onToggle}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

/**
 * Sketchbook take on cal.com's header: at the top of the page it is an open,
 * borderless row; once scrolled it tucks into a narrower taped paper strip.
 * Dropdowns open on hover/focus/click; the mobile sheet closes on Escape or navigation.
 */
export function Navbar() {
  const scrolled = useScrolled();
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = () => setMobileOpen(false);
  return (
    <header
      className="d3-header"
      data-scrolled={scrolled}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !mobileOpen) return;
        closeMobile();
        event.currentTarget.querySelector<HTMLButtonElement>(".d3-menu-toggle")?.focus();
      }}
    >
      <div className="d3-header-bar">
        <Tape className="d3-tape-left" />
        <Brand />
        <DesktopNav />
        <HeaderActions />
        <MobileToggle open={mobileOpen} onToggle={() => setMobileOpen((value) => !value)} />
        <Tape className="d3-tape-right" />
      </div>
      <MobileSheet open={mobileOpen} onNavigate={closeMobile} />
    </header>
  );
}

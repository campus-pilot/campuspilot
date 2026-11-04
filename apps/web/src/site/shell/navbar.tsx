import { useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Menu, Sparkles, X } from "lucide-react";
import { Link, NavLink } from "react-router";
import { BrandGlyph } from "@campuspilot/components/brand-logo";

import { LoginButton } from "./login-dialog";
import { navLinks, navMenus, type NavGroup, type NavLinkItem, type NavMenu } from "./nav-data";

/** Distance (px) after which the bar condenses into its floating, bordered form. */
const SCROLL_THRESHOLD = 12;

/** Delay before a hover-opened menu closes, so the pointer can cross the gap to the panel. */
const HOVER_CLOSE_DELAY = 140;

function subscribeToScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

/**
 * Reports whether the page has scrolled past the threshold. Uses an external
 * store subscription instead of an effect; the snapshot is a boolean so React
 * only re-renders when the bar actually switches state.
 */
function useScrolled() {
  return useSyncExternalStore(
    subscribeToScroll,
    () => window.scrollY > SCROLL_THRESHOLD,
    () => false,
  );
}

/**
 * Disclosure-style desktop menus (the W3C pattern for site navigation): a mouse
 * opens them on hover, while keyboard and touch toggle them by activating the
 * trigger. Only one menu is open at a time. A click that follows a hover keeps
 * the menu open rather than toggling it shut under the pointer.
 */
function useNavMenus() {
  const [openId, setOpenId] = useState<string | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const lastPointer = useRef("");

  function cancelClose() {
    window.clearTimeout(closeTimer.current);
  }

  function open(id: string) {
    cancelClose();
    setOpenId(id);
  }

  function close() {
    cancelClose();
    setOpenId(null);
  }

  function getItemProps(id: string) {
    return {
      onPointerEnter: (event: React.PointerEvent) => {
        if (event.pointerType === "mouse") open(id);
      },
      onPointerLeave: (event: React.PointerEvent) => {
        if (event.pointerType !== "mouse") return;
        cancelClose();
        closeTimer.current = window.setTimeout(() => setOpenId(null), HOVER_CLOSE_DELAY);
      },
      onBlur: (event: React.FocusEvent<HTMLLIElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOpenId((current) => (current === id ? null : current));
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLLIElement>) => {
        if (event.key !== "Escape" || openId !== id) return;
        close();
        event.currentTarget.querySelector<HTMLButtonElement>("[data-cp-trigger]")?.focus();
      },
    };
  }

  function getTriggerProps(id: string) {
    return {
      "aria-expanded": openId === id,
      onPointerDown: (event: React.PointerEvent) => {
        lastPointer.current = event.pointerType;
      },
      onClick: () => {
        const fromMouse = lastPointer.current === "mouse";
        lastPointer.current = "";
        if (fromMouse) open(id);
        else setOpenId((current) => (current === id ? null : id));
      },
    };
  }

  return { openId, close, getItemProps, getTriggerProps };
}

/** Icon inside its tile; the `cp-icon-<motion>` class picks the hover animation. */
function MenuIcon({ item }: { item: NavLinkItem }) {
  const Icon = item.icon;
  return (
    <span className={`cp-menu-tile cp-icon-${item.motion}`} aria-hidden="true">
      <Icon />
    </span>
  );
}

function MenuLink({ item, onNavigate }: { item: NavLinkItem; onNavigate: () => void }) {
  return (
    <Link className="cp-menu-link" to={item.href} onClick={onNavigate}>
      <MenuIcon item={item} />
      <span className="cp-menu-text">
        <b>{item.label}</b>
        <small>{item.description}</small>
      </span>
    </Link>
  );
}

function MenuGroupList({ group, onNavigate }: { group: NavGroup; onNavigate: () => void }) {
  return (
    <div className="cp-menu-group">
      <p className="cp-menu-group-label">{group.label}</p>
      <ul>
        {group.items.map((item) => (
          <li key={item.href}>
            <MenuLink item={item} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Dark promo card in the Product menu that carries the AI-ready message. */
function AiSpotlight({ onNavigate }: { onNavigate: () => void }) {
  return (
    <Link className="cp-spotlight" to="/ai-ready" onClick={onNavigate}>
      <span className="cp-spotlight-badge">
        <Sparkles aria-hidden="true" /> AI-ready
      </span>
      <span className="cp-spotlight-orbit" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <b>Answers from your live records</b>
      <small>Assistants only see what that person may see.</small>
    </Link>
  );
}

function MenuPanel({ menu, onNavigate }: { menu: NavMenu; onNavigate: () => void }) {
  return (
    <div className={`cp-menu-panel ${menu.spotlight ? "has-spotlight" : ""}`}>
      {menu.groups.map((group) => (
        <MenuGroupList key={group.label} group={group} onNavigate={onNavigate} />
      ))}
      {menu.spotlight ? <AiSpotlight onNavigate={onNavigate} /> : null}
    </div>
  );
}

function NavDropdown({ menu, menus }: { menu: NavMenu; menus: ReturnType<typeof useNavMenus> }) {
  const panelId = `cp-menu-${menu.id}`;
  const isOpen = menus.openId === menu.id;
  return (
    <li className="cp-nav-item" data-open={isOpen || undefined} {...menus.getItemProps(menu.id)}>
      <button type="button" className="cp-nav-trigger" aria-controls={panelId} data-cp-trigger {...menus.getTriggerProps(menu.id)}>
        {menu.label}
        <ChevronDown aria-hidden="true" />
      </button>
      <div className="cp-menu-wrap" id={panelId} inert={!isOpen}>
        <MenuPanel menu={menu} onNavigate={menus.close} />
      </div>
    </li>
  );
}

function DesktopNav() {
  const menus = useNavMenus();
  return (
    <nav className="cp-nav" aria-label="Main">
      <ul className="cp-nav-list">
        {navMenus.map((menu) => (
          <NavDropdown key={menu.id} menu={menu} menus={menus} />
        ))}
        {navLinks.map((link) => (
          <li key={link.href}>
            <NavLink className="cp-nav-trigger" to={link.href}>{link.label}</NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function BrandMark() {
  return (
    <Link to="/" className="cp-brand" aria-label="CampusPilot home">
      <BrandGlyph product="campuspilot" width={28} height={28} />
      <span>CampusPilot</span>
    </Link>
  );
}

function HeaderActions() {
  return (
    <div className="cp-header-actions">
      <LoginButton className="cp-login">Log in</LoginButton>
      <Link className="cp-btn cp-btn-primary cp-btn-sm" to="/book-demo">
        Book a demo <ChevronRight aria-hidden="true" />
      </Link>
    </div>
  );
}

function MobileGroup({ menu, onNavigate }: { menu: NavMenu; onNavigate: () => void }) {
  const items = menu.groups.flatMap((group) => group.items);
  return (
    <details className="cp-mobile-group" name="cp-mobile-nav">
      <summary>
        {menu.label}
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="cp-mobile-links">
        {items.map((item) => (
          <MenuLink key={item.href} item={item} onNavigate={onNavigate} />
        ))}
      </div>
    </details>
  );
}

function MobilePanel({ isOpen, onNavigate }: { isOpen: boolean; onNavigate: () => void }) {
  return (
    <div className="cp-mobile-panel" id="cp-mobile-menu" data-open={isOpen || undefined} inert={!isOpen}>
      <nav aria-label="Mobile" className="cp-mobile-nav">
        {navMenus.map((menu) => (
          <MobileGroup key={menu.id} menu={menu} onNavigate={onNavigate} />
        ))}
        {navLinks.map((link) => (
          <Link key={link.href} className="cp-mobile-anchor" to={link.href} onClick={onNavigate}>{link.label}</Link>
        ))}
      </nav>
      <div className="cp-mobile-actions">
        <LoginButton className="cp-btn cp-btn-light" onOpen={onNavigate}>Log in</LoginButton>
        <Link className="cp-btn cp-btn-primary" to="/book-demo" onClick={onNavigate}>
          Book a demo <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function MobileToggle({ isOpen, onToggle, buttonRef }: { isOpen: boolean; onToggle: () => void; buttonRef: React.Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className="cp-mobile-toggle"
      aria-expanded={isOpen}
      aria-controls="cp-mobile-menu"
      aria-label={isOpen ? "Close menu" : "Open menu"}
      onClick={onToggle}
    >
      {isOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
    </button>
  );
}

/**
 * Two visual states: transparent and full-width at the top of the page, then a
 * condensed, floating, blurred bar once scrolled. The mobile sheet forces the
 * solid state so its links never sit on top of page content.
 */
export function Navbar() {
  const scrolled = useScrolled();
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  function closeMobile() {
    setMobileOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Escape" || !mobileOpen) return;
    closeMobile();
    toggleRef.current?.focus();
  }

  return (
    <header className="cp-header" data-scrolled={scrolled || undefined} data-menu-open={mobileOpen || undefined} onKeyDown={handleKeyDown}>
      <div className="cp-header-bar">
        <BrandMark />
        <DesktopNav />
        <HeaderActions />
        <MobileToggle isOpen={mobileOpen} onToggle={() => setMobileOpen((open) => !open)} buttonRef={toggleRef} />
      </div>
      <MobilePanel isOpen={mobileOpen} onNavigate={closeMobile} />
    </header>
  );
}

import { useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Menu, Sparkles, X } from "lucide-react";
import { Link } from "react-router";

import { navAnchors, navMenus, type NavGroup, type NavLinkItem, type NavMenu } from "./nav-data";

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
        event.currentTarget.querySelector<HTMLButtonElement>("[data-d1-trigger]")?.focus();
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

/** Icon inside its tile; the `d1-icon-<motion>` class picks the hover animation. */
function MenuIcon({ item }: { item: NavLinkItem }) {
  const Icon = item.icon;
  return (
    <span className={`d1-menu-tile d1-icon-${item.motion}`} aria-hidden="true">
      <Icon />
    </span>
  );
}

function MenuLink({ item, onNavigate }: { item: NavLinkItem; onNavigate: () => void }) {
  return (
    <Link className="d1-menu-link" to={item.href} onClick={onNavigate}>
      <MenuIcon item={item} />
      <span className="d1-menu-text">
        <b>{item.label}</b>
        <small>{item.description}</small>
      </span>
    </Link>
  );
}

function MenuGroupList({ group, onNavigate }: { group: NavGroup; onNavigate: () => void }) {
  return (
    <div className="d1-menu-group">
      <p className="d1-menu-group-label">{group.label}</p>
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
    <Link className="d1-spotlight" to="/ai-ready" onClick={onNavigate}>
      <span className="d1-spotlight-badge">
        <Sparkles aria-hidden="true" /> AI-ready
      </span>
      <span className="d1-spotlight-orbit" aria-hidden="true">
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
    <div className={`d1-menu-panel ${menu.spotlight ? "has-spotlight" : ""}`}>
      {menu.groups.map((group) => (
        <MenuGroupList key={group.label} group={group} onNavigate={onNavigate} />
      ))}
      {menu.spotlight ? <AiSpotlight onNavigate={onNavigate} /> : null}
    </div>
  );
}

function NavDropdown({ menu, menus }: { menu: NavMenu; menus: ReturnType<typeof useNavMenus> }) {
  const panelId = `d1-menu-${menu.id}`;
  const isOpen = menus.openId === menu.id;
  return (
    <li className="d1-nav-item" data-open={isOpen || undefined} {...menus.getItemProps(menu.id)}>
      <button type="button" className="d1-nav-trigger" aria-controls={panelId} data-d1-trigger {...menus.getTriggerProps(menu.id)}>
        {menu.label}
        <ChevronDown aria-hidden="true" />
      </button>
      <div className="d1-menu-wrap" id={panelId} inert={!isOpen}>
        <MenuPanel menu={menu} onNavigate={menus.close} />
      </div>
    </li>
  );
}

function DesktopNav() {
  const menus = useNavMenus();
  return (
    <nav className="d1-nav" aria-label="Main">
      <ul className="d1-nav-list">
        {navMenus.map((menu) => (
          <NavDropdown key={menu.id} menu={menu} menus={menus} />
        ))}
        {navAnchors.map((anchor) => (
          <li key={anchor.href}>
            <a className="d1-nav-trigger" href={anchor.href}>{anchor.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function BrandMark() {
  return (
    <Link to="/" className="d1-brand" aria-label="CampusPilot home">
      <img src="/icon.svg" alt="" width={26} height={26} />
      <span>CampusPilot</span>
    </Link>
  );
}

function HeaderActions() {
  return (
    <div className="d1-header-actions">
      <Link className="d1-login" to="/login">Log in</Link>
      <Link className="d1-btn d1-btn-dark d1-btn-sm" to="/book-demo">
        Book a demo <ChevronRight aria-hidden="true" />
      </Link>
    </div>
  );
}

function MobileGroup({ menu, onNavigate }: { menu: NavMenu; onNavigate: () => void }) {
  const items = menu.groups.flatMap((group) => group.items);
  return (
    <details className="d1-mobile-group" name="d1-mobile-nav">
      <summary>
        {menu.label}
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="d1-mobile-links">
        {items.map((item) => (
          <MenuLink key={item.href} item={item} onNavigate={onNavigate} />
        ))}
      </div>
    </details>
  );
}

function MobilePanel({ isOpen, onNavigate }: { isOpen: boolean; onNavigate: () => void }) {
  return (
    <div className="d1-mobile-panel" id="d1-mobile-menu" data-open={isOpen || undefined} inert={!isOpen}>
      <nav aria-label="Mobile" className="d1-mobile-nav">
        {navMenus.map((menu) => (
          <MobileGroup key={menu.id} menu={menu} onNavigate={onNavigate} />
        ))}
        {navAnchors.map((anchor) => (
          <a key={anchor.href} className="d1-mobile-anchor" href={anchor.href} onClick={onNavigate}>{anchor.label}</a>
        ))}
      </nav>
      <div className="d1-mobile-actions">
        <Link className="d1-btn d1-btn-light" to="/login" onClick={onNavigate}>Log in</Link>
        <Link className="d1-btn d1-btn-dark" to="/book-demo" onClick={onNavigate}>
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
      className="d1-mobile-toggle"
      aria-expanded={isOpen}
      aria-controls="d1-mobile-menu"
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
    <header className="d1-header" data-scrolled={scrolled || undefined} data-menu-open={mobileOpen || undefined} onKeyDown={handleKeyDown}>
      <div className="d1-header-bar">
        <BrandMark />
        <DesktopNav />
        <HeaderActions />
        <MobileToggle isOpen={mobileOpen} onToggle={() => setMobileOpen((open) => !open)} buttonRef={toggleRef} />
      </div>
      <MobilePanel isOpen={mobileOpen} onNavigate={closeMobile} />
    </header>
  );
}

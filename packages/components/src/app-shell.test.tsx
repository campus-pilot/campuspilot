// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FileText, Home, NotebookPen, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  AppShell,
  AppShellAlert,
  AppShellSidebarSubLink,
  useAppShellCloseMobileSidebar,
  type AppShellLinkProps,
  type AppShellNavigationDisclosure,
} from './app-shell';
import { installPopupDomStubs } from './documents/combobox-test-setup';

/** Sets the window width the sidebar's `useIsMobile` reads (mobile is below 768px). */
function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: width < 768,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

/** A link that never navigates jsdom away, like the app's Next.js `Link`, recording what was followed. */
const followed: string[] = [];
function renderLink({ href, children, className, ariaCurrent, onClick }: AppShellLinkProps) {
  return (
    <a
      href={href}
      className={className}
      aria-current={ariaCurrent}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
        followed.push(href);
      }}
    >
      {children}
    </a>
  );
}

function renderShell(children: ReactNode = <p>Page</p>) {
  return render(
    <AppShell
      currentPath="/home"
      navigation={[
        { type: 'item', id: 'home', label: 'Home', href: '/home', icon: Home },
        {
          type: 'group',
          id: 'records',
          label: 'Records',
          items: [
            {
              type: 'item',
              id: 'documents',
              label: 'Documents',
              href: '/documents',
              icon: FileText,
              items: [{ type: 'item', id: 'history', label: 'History', href: '/documents/history', icon: FileText }],
            },
          ],
        },
      ]}
      breadcrumbs={[{ id: 'home', label: 'Home' }]}
      sidebarHeader={<span>School</span>}
      search={null}
      footerLinks={[{ id: 'settings', label: 'Settings', href: '/settings', icon: Settings }]}
      user={{ name: 'Test User', secondaryLabel: 'Principal' }}
      renderLink={renderLink}
    >
      {children}
    </AppShell>,
  );
}

/** The mobile sidebar is a dialog (a sheet); it is in the document only while open. */
const sidebarSheet = () => screen.queryByRole('dialog');
const openSidebar = () => fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
const sidebarLink = (name: string) => screen.getByRole('link', { name });

beforeAll(installPopupDomStubs);
afterEach(() => {
  cleanup();
  followed.length = 0;
});

describe('the app shell sidebar on mobile', () => {
  it.each([
    ['a navigation item', 'Home'],
    ['an item inside a group', 'Documents'],
    ['a sub-item', 'History'],
    ['the Docs link', 'Docs'],
    ['a footer link', 'Settings'],
  ])('closes when %s is followed', (_kind, name) => {
    setViewportWidth(390);
    renderShell();
    openSidebar();
    expect(sidebarSheet()).not.toBeNull();

    fireEvent.click(sidebarLink(name));

    expect(followed).toHaveLength(1);
    expect(sidebarSheet()).toBeNull();
  });

  it('stays open when the link is opened in a new tab or window', () => {
    setViewportWidth(390);
    renderShell();
    openSidebar();

    fireEvent.click(sidebarLink('Documents'), { metaKey: true });
    fireEvent.click(sidebarLink('Documents'), { ctrlKey: true });
    fireEvent.click(sidebarLink('Documents'), { shiftKey: true });

    expect(sidebarSheet()).not.toBeNull();
  });
});

describe('the app shell sidebar on desktop', () => {
  it('stays as it is when a link is followed', () => {
    setViewportWidth(1280);
    renderShell();

    fireEvent.click(sidebarLink('Documents'));

    expect(followed).toEqual(['/documents']);
    // The desktop sidebar is part of the page, not a sheet: it is still there after the click.
    expect(sidebarLink('Settings')).toBeTruthy();
    expect(sidebarSheet()).toBeNull();
  });
});

describe('page alerts', () => {
  it('shows a higher priority alert first, even when it registered after the page filled the two places', () => {
    setViewportWidth(1280);
    renderShell(
      <>
        <AppShellAlert slug="page:one" message="First page alert" />
        <AppShellAlert slug="page:two" message="Second page alert" />
        <AppShellAlert slug="school:read-only" message="This school is suspended" priority={1} />
      </>,
    );
    const shown = screen.getAllByRole('alert').map((alert) => alert.textContent);
    expect(shown).toHaveLength(2);
    expect(shown[0]).toContain('This school is suspended');
    expect(shown[1]).toContain('First page alert');
  });
});

/** App-owned disclosure content: a link and a control that navigates in code. */
function PapersContent({ onPick }: { onPick: () => void }) {
  const closeMobileSidebar = useAppShellCloseMobileSidebar();
  return (
    <ul>
      <li>
        <AppShellSidebarSubLink href="/papers/new">Add examination</AppShellSidebarSubLink>
      </li>
      <li>
        <button
          type="button"
          onClick={() => {
            closeMobileSidebar();
            onPick();
          }}
        >
          Class 8
        </button>
      </li>
    </ul>
  );
}

function renderDisclosureShell(
  disclosure: Partial<AppShellNavigationDisclosure> = {},
  onPick: () => void = () => undefined,
  currentPath = '/home',
) {
  return render(
    <AppShell
      currentPath={currentPath}
      navigation={[
        { type: 'item', id: 'home', label: 'Home', href: '/home', icon: Home },
        {
          type: 'group',
          id: 'academics',
          label: 'Academics',
          items: [
            {
              type: 'disclosure',
              id: 'papers',
              label: 'Question papers',
              icon: NotebookPen,
              content: <PapersContent onPick={onPick} />,
              ...disclosure,
            },
          ],
        },
      ]}
      breadcrumbs={[]}
      sidebarHeader={<span>School</span>}
      search={null}
      user={{ name: 'Test User', secondaryLabel: 'Principal' }}
      renderLink={renderLink}
    >
      <p>Page</p>
    </AppShell>,
  );
}

const papersTrigger = () => screen.getByRole('button', { name: 'Question papers' });

describe('a disclosure entry in the sidebar', () => {
  it('mounts its app-owned content only while open', () => {
    setViewportWidth(1280);
    renderDisclosureShell();
    expect(papersTrigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Class 8')).toBeNull();

    fireEvent.click(papersTrigger());
    expect(papersTrigger().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Class 8')).toBeTruthy();

    fireEvent.click(papersTrigger());
    expect(screen.queryByText('Class 8')).toBeNull();
  });

  it('renders content links with the app link and highlights the trigger as the app says', () => {
    setViewportWidth(1280);
    renderDisclosureShell({ isActive: (path) => path.startsWith('/papers') }, undefined, '/papers/one');
    expect(papersTrigger().getAttribute('data-active')).toBe('true');
    fireEvent.click(papersTrigger());
    fireEvent.click(sidebarLink('Add examination'));
    expect(followed).toEqual(['/papers/new']);
  });

  it('is left out entirely when the app gate renders nothing', () => {
    setViewportWidth(1280);
    renderDisclosureShell({ wrap: () => null });
    expect(screen.queryByRole('button', { name: 'Question papers' })).toBeNull();
  });

  it('works in the mobile sheet, which closes on a content link or a choice made in code', () => {
    setViewportWidth(390);
    const onPick = vi.fn();
    renderDisclosureShell({}, onPick);

    openSidebar();
    fireEvent.click(papersTrigger());
    fireEvent.click(sidebarLink('Add examination'));
    expect(followed).toEqual(['/papers/new']);
    expect(sidebarSheet()).toBeNull();

    openSidebar();
    fireEvent.click(papersTrigger());
    fireEvent.click(screen.getByRole('button', { name: 'Class 8' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(sidebarSheet()).toBeNull();
  });
});

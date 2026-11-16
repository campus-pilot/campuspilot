// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FileText, Home, Settings } from 'lucide-react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppShell, type AppShellLinkProps } from './app-shell';
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

function renderShell() {
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
      <p>Page</p>
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

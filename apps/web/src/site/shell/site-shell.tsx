import { AnnouncementBar } from "./announcement-bar";
import { Footer } from "./footer";
import { LoginDialogProvider } from "./login-dialog";
import { Navbar } from "./navbar";

/**
 * Chrome shared by every site page: skip link, the fixed navbar, the launch announcement, and the framed
 * column (thin guide lines on desktop) that holds the page's sections and the
 * footer. Pages render only their sections; `<main>` is owned here so every page
 * has exactly one main landmark with the skip-link target. The login dialog
 * provider wraps everything so any "Log in" on any page opens the same chooser.
 */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <LoginDialogProvider>
      <div className="cp-page">
        <a className="cp-skip" href="#main">Skip to content</a>
        <Navbar />
        <div className="cp-frame">
          <AnnouncementBar />
          <main id="main">{children}</main>
          <Footer />
        </div>
      </div>
    </LoginDialogProvider>
  );
}

import { createContext, use, useRef } from "react";
import { env } from "@campuspilot/env/web.client";
import { ArrowUpRight, GraduationCap, UsersRound, X, type LucideIcon } from "lucide-react";
import { Link } from "react-router";

/** Opens the shared login dialog; provided by `LoginDialogProvider` inside `SiteShell`. */
const OpenLoginContext = createContext<(() => void) | null>(null);

type Workspace = {
  icon: LucideIcon;
  title: string;
  text: string;
  /** Empty when the workspace isn't deployed yet; the row then shows "Coming soon". */
  href: string;
};

/**
 * Destinations come from env: `VITE_STAFF_LOGIN_URL` is required, while
 * `VITE_STUDENT_LOGIN_URL` stays optional until the student and family
 * workspace is deployed.
 */
const workspaces: readonly Workspace[] = [
  {
    icon: UsersRound,
    title: "Log in as staff",
    text: "Principals, teachers, accountants and office staff",
    href: env.VITE_STAFF_LOGIN_URL,
  },
  {
    icon: GraduationCap,
    title: "Log in as student",
    text: "Students and families: results, fees and notices",
    href: env.VITE_STUDENT_LOGIN_URL ?? "",
  },
];

function WorkspaceText({ workspace }: { workspace: Workspace }) {
  const Icon = workspace.icon;
  return (
    <>
      <span className="cp-login-row-icon" aria-hidden="true">
        <Icon />
      </span>
      <span className="cp-login-row-text">
        <b>{workspace.title}</b>
        <small>{workspace.text}</small>
      </span>
    </>
  );
}

function WorkspaceRow({ workspace }: { workspace: Workspace }) {
  if (!workspace.href) {
    return (
      <div className="cp-login-row is-disabled" aria-disabled="true">
        <WorkspaceText workspace={workspace} />
        <span className="cp-login-row-soon">Coming soon</span>
      </div>
    );
  }
  return (
    <a className="cp-login-row" href={workspace.href}>
      <WorkspaceText workspace={workspace} />
      <ArrowUpRight className="cp-login-row-arrow" aria-hidden="true" />
    </a>
  );
}

function LoginDialogHead({ onClose }: { onClose: () => void }) {
  return (
    <div className="cp-login-head">
      <img src="/icon.svg" alt="" width={36} height={36} />
      <h2 id="cp-login-title">Log in to CampusPilot</h2>
      <p>Choose your workspace.</p>
      <button type="button" className="cp-login-close" aria-label="Close" onClick={onClose}>
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Native modal `<dialog>`: `showModal()` gives focus trapping, Escape to close
 * and the top layer for free. The panel fills the dialog box, so a click whose
 * target is the dialog itself can only have landed on the backdrop.
 */
function LoginDialog({ dialogRef }: { dialogRef: React.RefObject<HTMLDialogElement | null> }) {
  function close() {
    dialogRef.current?.close();
  }

  return (
    <dialog
      ref={dialogRef}
      className="cp-login-dialog"
      aria-labelledby="cp-login-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="cp-login-panel">
        <LoginDialogHead onClose={close} />
        <div className="cp-login-rows">
          {workspaces.map((workspace) => (
            <WorkspaceRow key={workspace.title} workspace={workspace} />
          ))}
        </div>
        <p className="cp-login-foot">
          New to CampusPilot?{" "}
          <Link to="/book-demo" onClick={close}>
            Book a demo
          </Link>
        </p>
      </div>
    </dialog>
  );
}

/** Renders the single login dialog and lets any descendant open it via `LoginButton`. */
export function LoginDialogProvider({ children }: { children: React.ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  function open() {
    dialogRef.current?.showModal();
  }
  return (
    <OpenLoginContext value={open}>
      {children}
      <LoginDialog dialogRef={dialogRef} />
    </OpenLoginContext>
  );
}

type LoginButtonProps = {
  children: React.ReactNode;
  className: string;
  /** Runs before the dialog opens, e.g. to close the mobile menu. */
  onOpen?: () => void;
};

/** Every "Log in" on the site: a button that opens the staff/student chooser instead of navigating. */
export function LoginButton({ children, className, onOpen }: LoginButtonProps) {
  const open = use(OpenLoginContext);
  if (!open) throw new Error("LoginButton must be rendered inside LoginDialogProvider");
  return (
    <button
      type="button"
      className={className}
      aria-haspopup="dialog"
      onClick={() => {
        onOpen?.();
        open();
      }}
    >
      {children}
    </button>
  );
}

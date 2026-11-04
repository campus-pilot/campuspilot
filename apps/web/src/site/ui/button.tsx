import { ArrowRight, ChevronRight } from "lucide-react";
import { Link } from "react-router";

type ButtonTone = "primary" | "light";
type ButtonSize = "sm" | "md" | "lg";

type ButtonLinkProps = {
  children: React.ReactNode;
  /** Internal paths render a router `Link`; `http(s):`, `mailto:`, `tel:` and `#hash` render a plain anchor. */
  href: string;
  size?: ButtonSize;
  tone?: ButtonTone;
  /** Opens external links in a new tab with `noreferrer`. */
  external?: boolean;
  onClick?: () => void;
};

/** Primary actions use the platform orange; secondary actions stay white. */
const TONE_CLASS: Record<ButtonTone, string> = {
  primary: "cp-btn-primary",
  light: "cp-btn-light",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "cp-btn-sm",
  md: "",
  lg: "cp-btn-lg",
};

function isPlainAnchor(href: string) {
  return /^(https?:|mailto:|tel:|#)/.test(href);
}

/**
 * The site's only button. Every call to action is a link, so this never renders
 * a `<button>`; the trailing icon nudges right on hover (see `.cp-btn svg`).
 */
export function ButtonLink({ children, href, size = "md", tone = "primary", external = false, onClick }: ButtonLinkProps) {
  const className = `cp-btn ${TONE_CLASS[tone]} ${SIZE_CLASS[size]}`.trim();
  const Icon = tone === "primary" ? ArrowRight : ChevronRight;
  const content = (
    <>
      {children} <Icon aria-hidden="true" />
    </>
  );
  if (isPlainAnchor(href)) {
    return (
      <a className={className} href={href} onClick={onClick} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
        {content}
      </a>
    );
  }
  return (
    <Link className={className} to={href} onClick={onClick}>
      {content}
    </Link>
  );
}

/** Row of call-to-action buttons; wraps on narrow screens. */
export function ButtonRow({ children, center = false }: { children: React.ReactNode; center?: boolean }) {
  return <div className={`cp-hero-actions ${center ? "cp-center" : ""}`.trim()}>{children}</div>;
}

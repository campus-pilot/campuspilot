import { Eye } from "lucide-react";

/** `--i` drives the staggered rise-in of console parts (see `.pg-sol-rise`). */
export function rise(index: number) {
  return { "--i": index } as React.CSSProperties;
}

type ConsoleFrameProps = {
  /** Modifier for the per-role layout: `pg-sol-console-<name>`. */
  name: string;
  /** Window title, e.g. the module or the signed-in person. */
  title: string;
  /** What this role sees, shown in the eye chip ("Teacher · 2 classes"). */
  scope: string;
  /** Accessible description of the whole console. */
  label: string;
  /**
   * Static consoles are one labelled image (`role="img"`), so their mock text
   * is not read item by item. Interactive ones (the campus switcher) contain
   * real buttons, so they are a labelled group instead.
   */
  interactive?: boolean;
  children: React.ReactNode;
};

/**
 * Compact "what this role sees" window used as every solution page's hero
 * visual: a title bar with the role's scope, and a body each role fills in
 * its own way. Base styles are the finished state; parts with `.pg-sol-rise`
 * rise in once on load.
 */
export function ConsoleFrame({ name, title, scope, label, interactive = false, children }: ConsoleFrameProps) {
  const a11y = interactive ? ({ role: "group", "aria-label": label } as const) : ({ role: "img", "aria-label": label } as const);
  return (
    <div className={`pg-sol-console pg-sol-console-${name}`} {...a11y}>
      <p className="pg-sol-console-bar">
        <span className="pg-sol-console-dots" aria-hidden="true"><i /><i /><i /></span>
        <b>{title}</b>
        <span className="pg-sol-scope"><Eye aria-hidden="true" />{scope}</span>
      </p>
      <div className="pg-sol-console-body">{children}</div>
    </div>
  );
}

/** Small progress bar; the fill grows in from the left on load. */
export function Meter({ value }: { value: number }) {
  return (
    <span className="pg-sol-meter" aria-hidden="true">
      <i style={{ width: `${value}%` }} />
    </span>
  );
}

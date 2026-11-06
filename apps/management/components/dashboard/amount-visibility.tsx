"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import {
  formatCompactMinorIndian,
  formatMinorIndian,
} from "@campuspilot/components/finance";
import { Button } from "@campuspilot/ui/components/button";
import { Eye, EyeOff } from "lucide-react";

const MASK = "****";

type VisibilityState = {
  /** Default for every scope that has not been toggled on its own. */
  global: boolean;
  /** Per-scope choices; they win over `global` until the global toggle is used. */
  overrides: Record<string, boolean>;
};

type AmountVisibility = {
  global: boolean;
  isRevealed: (scope: string) => boolean;
  toggle: (scope: string) => void;
  toggleAll: () => void;
};

const AmountVisibilityContext = createContext<AmountVisibility | null>(null);

/** Holds whether dashboard financial figures are shown. Everything starts
 * hidden on every visit so an open dashboard does not expose school income to
 * onlookers. The choice is intentionally kept in memory only: it is not
 * persisted, so a reload or a new visit is hidden again. */
export function AmountVisibilityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VisibilityState>({ global: false, overrides: {} });
  const isRevealed = (scope: string) => state.overrides[scope] ?? state.global;
  const value: AmountVisibility = {
    global: state.global,
    isRevealed,
    toggle: (scope) =>
      setState((current) => ({
        ...current,
        overrides: {
          ...current.overrides,
          [scope]: !(current.overrides[scope] ?? current.global),
        },
      })),
    // The global toggle resets scoped choices so every figure follows it.
    toggleAll: () => setState((current) => ({ global: !current.global, overrides: {} })),
  };
  return <AmountVisibilityContext.Provider value={value}>{children}</AmountVisibilityContext.Provider>;
}

function useAmountVisibility() {
  const context = useContext(AmountVisibilityContext);
  if (!context) throw new Error("useAmountVisibility requires AmountVisibilityProvider");
  return context;
}

export function useAmountRevealed(scope: string) {
  return useAmountVisibility().isRevealed(scope);
}

/** A compact Indian amount (₹1.23L) whose exact value is in the tooltip, or a
 * mask while its scope is hidden. */
export function MaskedAmount({
  scope,
  minor,
  currency,
}: {
  scope: string;
  minor: string;
  currency: string;
}) {
  const revealed = useAmountRevealed(scope);
  if (!revealed) return <span aria-label="Hidden amount">{MASK}</span>;
  return <span title={formatMinorIndian(minor, currency)}>{formatCompactMinorIndian(minor, currency)}</span>;
}

/** Masks non-amount financial text such as collection rates. */
export function MaskedText({ scope, children }: { scope: string; children: ReactNode }) {
  const revealed = useAmountRevealed(scope);
  return revealed ? <>{children}</> : <span aria-label="Hidden value">{MASK}</span>;
}

function VisibilityButton({
  revealed,
  label,
  onToggle,
  className,
}: {
  revealed: boolean;
  label: string;
  onToggle: () => void;
  className?: string;
}) {
  const Icon = revealed ? EyeOff : Eye;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-pressed={revealed}
      aria-label={`${revealed ? "Hide" : "Show"} ${label}`}
      title={`${revealed ? "Hide" : "Show"} ${label}`}
      onClick={onToggle}
      className={className ?? "text-muted-foreground"}
    >
      <Icon aria-hidden />
    </Button>
  );
}

/** Shows or hides the figures of one dashboard section. */
export function AmountVisibilityToggle({
  scope,
  label,
  className,
}: {
  scope: string;
  label: string;
  className?: string;
}) {
  const visibility = useAmountVisibility();
  return (
    <VisibilityButton
      revealed={visibility.isRevealed(scope)}
      label={label}
      onToggle={() => visibility.toggle(scope)}
      className={className}
    />
  );
}

/** Shows or hides every financial figure on the dashboard at once. */
export function GlobalAmountVisibilityToggle() {
  const visibility = useAmountVisibility();
  return (
    <VisibilityButton
      revealed={visibility.global}
      label="all amounts"
      onToggle={visibility.toggleAll}
    />
  );
}

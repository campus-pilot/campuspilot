import { Bot, Lock, ShieldCheck } from "lucide-react";

import { staggerStyle } from "./reveal";

const scopes = [
  ["Principal", "Whole school"],
  ["Accountant", "Fees and ledgers"],
  ["Class teacher", "Class 8 A only"],
  ["Family", "Aarav's records only"],
] as const;

function ScopeRow({ role, scope, index }: { role: string; scope: string; index: number }) {
  return (
    <li className="pg-features-sec-row" style={staggerStyle(index)}>
      <b>{role}</b>
      <span>
        <ShieldCheck />
        {scope}
      </span>
    </li>
  );
}

/**
 * Preview for the eighth feature-map entry (Security), which has no signature
 * artwork: who may see what, in the same framed light style (`cp-wt-art`).
 * Always decorative; the map's link text carries the meaning.
 */
export function SecurityPreview() {
  return (
    <div className="cp-wt-art pg-features-sec" aria-hidden="true">
      <p className="pg-features-sec-head">
        <Lock /> Who can see what · Riverview Public School
      </p>
      <ul className="pg-features-sec-list">
        {scopes.map(([role, scope], index) => (
          <ScopeRow key={role} role={role} scope={scope} index={index} />
        ))}
      </ul>
      <p className="pg-features-sec-foot" style={staggerStyle(scopes.length)}>
        <Bot /> Assistants follow the same boundaries as the person asking
      </p>
    </div>
  );
}

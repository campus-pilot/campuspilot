import { Lock, Table2 } from "lucide-react";

import { Section, SectionIntro } from "@/site/ui/section";

type RoleId = "principal" | "accountant" | "teacher" | "parent";

const roles: readonly { id: RoleId; label: string }[] = [
  { id: "principal", label: "Principal" },
  { id: "accountant", label: "Accountant" },
  { id: "teacher", label: "Class teacher" },
  { id: "parent", label: "Parent" },
];

/** A cell's scope text; `null` means no access. Kept in step with the `/ai-ready` network's roles. */
type Row = { area: string; access: Record<RoleId, string | null> };

const rows: readonly Row[] = [
  { area: "Admissions", access: { principal: "Whole school", accountant: null, teacher: null, parent: null } },
  { area: "Fees & ledgers", access: { principal: "Whole school", accountant: "All ledgers", teacher: null, parent: "Own child" } },
  { area: "Marks & results", access: { principal: "Whole school", accountant: null, teacher: "Assigned classes", parent: "Own child" } },
  { area: "Attendance", access: { principal: "Whole school", accountant: null, teacher: "Assigned classes", parent: null } },
  { area: "Timetables", access: { principal: "Whole school", accountant: null, teacher: "Assigned classes", parent: "Own child's class" } },
  { area: "Notices", access: { principal: "Whole school", accountant: null, teacher: "Their classes", parent: "Own child's class" } },
  { area: "Staff records", access: { principal: "Whole school", accountant: null, teacher: null, parent: null } },
  { area: "Documents", access: { principal: "Whole school", accountant: "Receipts only", teacher: null, parent: null } },
];

/** "Whole school" reads as full reach; any other text is a narrower scope. */
function AccessCell({ scope }: { scope: string | null }) {
  if (scope === null) {
    return (
      <td data-level="none">
        <Lock aria-hidden="true" />
        <span className="cp-sr-only">No access</span>
      </td>
    );
  }
  return (
    <td data-level={scope === "Whole school" ? "full" : "scoped"}>
      <span className="pg-sec-scope">{scope}</span>
    </td>
  );
}

function MatrixHead() {
  return (
    <thead>
      <tr>
        <th scope="col">Area</th>
        {roles.map((role) => <th key={role.id} scope="col">{role.label}</th>)}
      </tr>
    </thead>
  );
}

function MatrixBody() {
  return (
    <tbody>
      {rows.map((row) => (
        <tr key={row.area}>
          <th scope="row">{row.area}</th>
          {roles.map((role) => <AccessCell key={role.id} scope={row.access[role.id]} />)}
        </tr>
      ))}
    </tbody>
  );
}

/**
 * Illustrative "who sees what" matrix. A semantic table whose caption says it
 * is an example; on narrow screens it scrolls sideways inside its own
 * focusable region with the area column pinned.
 */
export function WhoSeesWhatSection() {
  return (
    <Section id="who-sees-what" labelledBy="pg-sec-matrix-title" className="pg-sec-matrix-section">
      <SectionIntro
        id="pg-sec-matrix-title"
        eyebrow="Who sees what"
        eyebrowIcon={Table2}
        title="Four people, one school, four different views."
        description="Here is how access could look at a typical school. Each school decides its own roles and what each one can open."
      />
      <div className="pg-sec-matrix-scroll" role="region" aria-labelledby="pg-sec-matrix-caption" tabIndex={0}>
        <table className="pg-sec-matrix">
          <caption id="pg-sec-matrix-caption">Example only: who sees what at an illustrative school</caption>
          <MatrixHead />
          <MatrixBody />
        </table>
      </div>
      <p className="pg-sec-matrix-legend" aria-hidden="true">
        <span data-level="full">Whole school</span>
        <span data-level="scoped">Narrower scope</span>
        <span data-level="none"><Lock />No access</span>
      </p>
    </Section>
  );
}

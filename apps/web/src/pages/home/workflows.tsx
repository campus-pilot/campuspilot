import { WorkflowTabsSection, workflowTabs, type WorkflowTab } from "@/site/signature";

/**
 * Home keeps all five workflow tabs, but the AI tab drops its roadmap note:
 * the home page states "today vs coming" once, in the AI section further down,
 * so the roadmap is not repeated in two places.
 */
const homeTabs: readonly WorkflowTab[] = workflowTabs.map((tab) => (tab.id === "ai" ? { ...tab, note: undefined } : tab));

/** The `/2`-born tabbed workflows, placed directly under the hero. */
export function WorkflowsSection() {
  return <WorkflowTabsSection tabs={homeTabs} />;
}

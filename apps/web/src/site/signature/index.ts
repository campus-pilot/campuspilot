/**
 * Shared signature components for the public site. Styles live in
 * `signature.css` (loaded on every site page by the `_site` layout).
 *
 * - WorkflowTabsSection / WorkflowTabs: tabbed workflows (home, under the hero).
 * - Feature artworks + `featureArt`: tab art and feature page hero visuals.
 * - ConsoleStage: `/product` hero visual.
 * - EventStream / EventStreamSection: events in, finished work out (`/product` full, home compact).
 * - DotsNetwork: "everything connected" (people) and permission-aware AI (ai).
 * - Notebook / NotebookSection: handwritten "done once" + AI chats spread.
 */
export { WorkflowTabs, WorkflowTabsSection, workflowTabs, type WorkflowTab, type WorkflowTabMotion } from "./workflow-tabs";
export {
  AcademicsArt,
  AdmissionsArt,
  AiArt,
  DashboardsArt,
  DocumentsArt,
  ExamsArt,
  FeesArt,
  NoticesArt,
  QuestionPapersArt,
  StudentPortalArt,
  featureArt,
  type ArtProps,
} from "./feature-art";
export { ConsoleStage } from "./console-stage";
export { EventStream, EventStreamSection } from "./event-stream";
export { DotsNetwork, peopleNodes, type AiRoleId, type DotsNetworkProps, type PeopleNode } from "./dots-network";
export {
  Notebook,
  NotebookSection,
  notebookDefaults,
  type NotebookChat,
  type NotebookChore,
  type NotebookProps,
  type NotebookRoadmap,
} from "./notebook";

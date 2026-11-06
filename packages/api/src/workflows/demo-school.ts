/**
 * Restate services hosted by `apps/worker`. Import from
 * `@campuspilot/api/workflows/demo-school`.
 */
export { demoSchoolWorkflow, type DemoSchoolWorkflow } from './demo-school/workflow';
export { demoSchoolPurgeWorkflow, type DemoSchoolPurgeWorkflow } from './demo-school/purge-workflow';

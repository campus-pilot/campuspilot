/**
 * The lead alert Restate services, hosted by `apps/worker`.
 * Import from `@campuspilot/api/workflows/lead-alert`.
 */
export { leadControlService, type LeadControlService } from './lead-alert/control-service';
export { leadAlertWorkflow, type LeadAlertWorkflow } from './lead-alert/workflow';
export { schoolOnboardingAlertWorkflow } from './lead-alert/onboarding-workflow';

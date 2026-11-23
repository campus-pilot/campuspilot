import { schoolTierRank, type SchoolTier } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import type { SchoolSetupDraft } from '@campuspilot/api/school-setup/school-setup.contract';

/** The tier the new school's plan will have when the setup runs: the higher of its standing tier and its trial's. */
export function plannedTier(plan: SchoolSetupDraft['plan']): SchoolTier | null {
  const trial = plan.trial.enabled ? plan.trial.tier : null;
  if (!plan.standingTier) return trial;
  if (!trial) return plan.standingTier;
  return schoolTierRank[trial] > schoolTierRank[plan.standingTier] ? trial : plan.standingTier;
}

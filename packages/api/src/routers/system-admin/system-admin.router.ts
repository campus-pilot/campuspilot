import { assistantUsageRouter } from "./assistant-usage/assistant-usage.router";
import { dataMigrationRouter } from "./data-migration/data-migration.router";
import { featureFlagsRouter } from "./feature-flags/feature-flags.router";
import { demoSchoolRouter } from "./demo-school/demo-school.router";
import { oauthClientRouter } from "./oauth-client/oauth-client.router";
import { schoolRouter } from "./school/school.router";
import { statsRouter } from "./stats/stats.router";

export const systemAdminRouter = {
  ...schoolRouter,
  ...oauthClientRouter,
  ...demoSchoolRouter,
  ...statsRouter,
  ...dataMigrationRouter,
  ...featureFlagsRouter,
  ...assistantUsageRouter,
};

import { assistantAccessRouter } from "./assistant-access/assistant-access.router";
import { assistantUsageRouter } from "./assistant-usage/assistant-usage.router";
import { dataMigrationRouter } from "./data-migration/data-migration.router";
import { featureFlagsRouter } from "./feature-flags/feature-flags.router";
import { leadRouter } from "./lead/lead.router";
import { schoolRegistrationRequestRouter } from "./school-registration-request/school-registration-request.router";
import { demoSchoolRouter } from "./demo-school/demo-school.router";
import { oauthClientRouter } from "./oauth-client/oauth-client.router";
import { schoolRouter } from "./school/school.router";
import { schoolBillingRouter } from "./school-billing/school-billing.router";
import { schoolCreationRequestRouter } from "./school-creation-request/school-creation-request.router";
import { statsRouter } from "./stats/stats.router";
import { userRouter } from "./user/user.router";

export const systemAdminRouter = {
  ...schoolRouter,
  ...schoolBillingRouter,
  ...schoolCreationRequestRouter,
  ...oauthClientRouter,
  ...demoSchoolRouter,
  ...statsRouter,
  ...dataMigrationRouter,
  ...featureFlagsRouter,
  ...assistantUsageRouter,
  ...assistantAccessRouter,
  ...userRouter,
  ...leadRouter,
  ...schoolRegistrationRequestRouter,
};

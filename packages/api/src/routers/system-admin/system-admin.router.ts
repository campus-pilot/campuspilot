import { oauthClientRouter } from "./oauth-client/oauth-client.router";
import { schoolRouter } from "./school/school.router";

export const systemAdminRouter = {
  ...schoolRouter,
  ...oauthClientRouter,
};

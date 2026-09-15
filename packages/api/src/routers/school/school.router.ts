import { schoolLogoRouter } from "./logo/logo.router";
import { schoolMemberRouter } from "./member/member.router";
import { schoolSessionRouter } from "./session/session.router";

export const schoolRouter = {
  ...schoolLogoRouter,
  ...schoolMemberRouter,
  ...schoolSessionRouter,
};

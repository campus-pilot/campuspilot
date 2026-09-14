import { schoolMemberRouter } from "./member/member.router";
import { schoolSessionRouter } from "./session/session.router";

export const schoolRouter = {
  ...schoolMemberRouter,
  ...schoolSessionRouter,
};

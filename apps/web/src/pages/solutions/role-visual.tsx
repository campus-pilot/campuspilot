import type { ComponentType } from "react";

import type { SolutionSlug } from "@/site/content/catalog";

import { SingleCampusConsole, MultiCampusConsole } from "./visuals-campus";
import { ExamConsole, FinanceConsole } from "./visuals-office";
import { AdminConsole, LeaderConsole, TeacherConsole } from "./visuals-team";

/** One distinct "what this role sees" console per solution page, used as the hero visual. */
export const roleVisual: Record<SolutionSlug, ComponentType> = {
  "school-leaders": LeaderConsole,
  administrators: AdminConsole,
  teachers: TeacherConsole,
  "finance-teams": FinanceConsole,
  "exam-teams": ExamConsole,
  "single-campus": SingleCampusConsole,
  "multi-campus": MultiCampusConsole,
};

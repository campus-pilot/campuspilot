import { Files } from "lucide-react";
import { defineManagementPage } from "@/components/management-route";
import { sessionPageBreadcrumbs } from "@/components/session-page-breadcrumbs";
import type { SchoolSessionRouteParams } from "@/components/school-route";

/** Each section owns a real route so breadcrumbs provide parent navigation. */
export const documentPages = [undefined, "templates", "history"].map(
  (section) =>
    defineManagementPage<SchoolSessionRouteParams>({
      matches: (pathname) =>
        new RegExp(
          `^/school/[^/]+/sessions/[^/]+/documents${section ? `/${section}` : ""}$`,
        ).test(pathname),
      breadcrumbs: ({ schoolId, sessionId }) => {
        const breadcrumbs = sessionPageBreadcrumbs(schoolId, sessionId, {
          id: "documents",
          label: "Documents",
          icon: Files,
        });
        if (section) {
          breadcrumbs[breadcrumbs.length - 1]!.href =
            `/school/${schoolId}/sessions/${sessionId}/documents`;
          breadcrumbs.push({
            id: section,
            label: section === "templates" ? "Templates" : "History",
          });
        }
        return breadcrumbs;
      },
    }),
);

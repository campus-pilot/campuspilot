import { SketchbookPage } from "@/demos/3/page";
import stylesheet from "@/demos/3/styles.css?url";

import type { Route } from "./+types/3";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "CampusPilot — every dot in your school, connected" },
    {
      name: "description",
      content:
        "CampusPilot connects teachers, students, families, office staff, accounts, exam teams and principals in one place — repeated admin work done once, and a school ready for AI.",
    },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

/** Kalam (hand-lettered headings, with Devanagari support) + Caveat (margin notes) + Inter (body). */
export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Inter:wght@400;500;600;700&family=Kalam:wght@400;700&display=swap",
  },
  { rel: "stylesheet", href: stylesheet },
];

export default function SketchbookRoute() {
  return <SketchbookPage />;
}

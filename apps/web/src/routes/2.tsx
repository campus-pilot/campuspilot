import { DemoPage } from "@/demos/2/page";
import stylesheet from "@/demos/2/styles.css?url";

import type { Route } from "./+types/2";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "CampusPilot — School admin done once, ready for AI" },
    {
      name: "description",
      content:
        "CampusPilot connects admissions, fees, examinations and documents for schools in India, so repeated admin work is done once and school data is ready for permission-aware AI.",
    },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap",
  },
  { rel: "stylesheet", href: stylesheet },
];

export default function DemoTwo() {
  return <DemoPage />;
}

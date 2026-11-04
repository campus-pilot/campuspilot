import { DemoOnePage } from "@/demos/1/page";
import primaryButtons from "@/demos/1/primary-buttons.css?url";
import stylesheet from "@/demos/1/styles.css?url";

import type { Route } from "./+types/1_.1";

/**
 * `/1/1`: page `/1` with primary-coloured buttons instead of black ones.
 * The `1_` segment keeps this route from nesting inside `/1`'s module.
 */
export function meta({}: Route.MetaArgs) {
  return [
    { title: "CampusPilot — School admin, done once. Ready for AI." },
    {
      name: "description",
      content:
        "CampusPilot is the connected school operating system for Indian schools: admissions, fees, marks and report cards entered once, with records ready for permission-aware AI assistants.",
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
  { rel: "stylesheet", href: primaryButtons },
];

export default function DemoOnePrimaryButtons() {
  return <DemoOnePage />;
}

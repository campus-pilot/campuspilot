import { createMeta } from "@/site/seo";
import { ContactPage } from "@/pages/contact/page";
import pageStyles from "@/pages/contact/page.css?url";
import requestStyles from "@/pages/contact/request.css?url";
import channelStyles from "@/pages/contact-channels/page.css?url";

import type { Route } from "./+types/_site.contact";

export function meta({}: Route.MetaArgs) {
  return createMeta("/contact");
}

export const links: Route.LinksFunction = () => [
  { rel: "stylesheet", href: channelStyles },
  { rel: "stylesheet", href: pageStyles },
  { rel: "stylesheet", href: requestStyles },
];

export default function ContactRoute() {
  return <ContactPage />;
}

import { createMeta } from "@/site/seo";
import { BookDemoPage } from "@/pages/book-demo/page";
import pageStyles from "@/pages/book-demo/page.css?url";
import channelStyles from "@/pages/contact-channels/page.css?url";

import type { Route } from "./+types/_site.book-demo";

export function meta({}: Route.MetaArgs) {
  return createMeta("/book-demo");
}

export const links: Route.LinksFunction = () => [
  { rel: "stylesheet", href: channelStyles },
  { rel: "stylesheet", href: pageStyles },
];

export default function BookDemoRoute() {
  return <BookDemoPage />;
}

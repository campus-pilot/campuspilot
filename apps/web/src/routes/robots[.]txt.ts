import { absoluteUrl } from "@/site/seo";

/**
 * `robots.txt`, prerendered. Utility pages such as `/dashboard` stay crawlable
 * on purpose: they carry `noindex`, and a crawler can only see that tag on a
 * page it is allowed to fetch. Blocked: the API namespaces, React Router's
 * `.data` payloads, and `/onboarding`, a form for people we send the link
 * to. It is disallowed as well as `noindex` (meta tag and `X-Robots-Tag`
 * header) because it should never be fetched by a crawler at all; nothing
 * links to it, so it has no inbound links that could surface it bare.
 */
export function loader() {
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /rpc/",
    "Disallow: /*.data$",
    "Disallow: /onboarding",
    "",
    `Sitemap: ${absoluteUrl("/sitemap.xml")}`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

import { absoluteUrl } from "@/site/seo";

/**
 * `robots.txt`, prerendered. Utility pages such as `/dashboard` stay crawlable
 * on purpose: they carry `noindex`, and a crawler can only see that tag on a
 * page it is allowed to fetch. Only the API namespaces and React Router's
 * `.data` payloads are blocked.
 */
export function loader() {
  const body = ["User-agent: *", "Allow: /", "Disallow: /api/", "Disallow: /rpc/", "Disallow: /*.data$", "", `Sitemap: ${absoluteUrl("/sitemap.xml")}`, ""].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

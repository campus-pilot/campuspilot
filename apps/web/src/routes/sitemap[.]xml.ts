import { absoluteUrl, seoRoutes } from "@/site/seo";

/**
 * `sitemap.xml`, prerendered from `seoRoutes` so it always lists exactly the
 * indexable pages. `lastmod`, `changefreq` and `priority` are left out on
 * purpose: Google ignores the last two, and a build date is not a real
 * content-modified date.
 */
export function loader() {
  const urls = seoRoutes.map(({ path }) => `  <url><loc>${absoluteUrl(path)}</loc></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}

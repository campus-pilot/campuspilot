import type { Config } from "@react-router/dev/config";

export default {
  appDirectory: "src",
  // The production image serves the client build as static files through nginx.
  ssr: false,
  /**
   * Every page is prerendered to its own `index.html`, so crawlers and link
   * previews (WhatsApp, LinkedIn, X) read the real content, title and Open
   * Graph tags without running JavaScript. Static routes come from the route
   * tree (including `sitemap.xml` and `robots.txt`); the parameterised feature
   * and solution pages and the social card PNGs come from `seoRoutes`.
   * Anything else falls back to `__spa-fallback.html` (see `nginx.conf`).
   */
  async prerender({ getStaticPaths }) {
    const { seoRoutes, socialImagePath } = await import("./src/site/seo");
    return [
      ...new Set([
        ...getStaticPaths(),
        ...seoRoutes.map(({ path }) => path),
        ...seoRoutes.map(({ path }) => socialImagePath(path)),
      ]),
    ];
  },
} satisfies Config;

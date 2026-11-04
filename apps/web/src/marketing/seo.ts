export const SITE_URL = "https://campuspilot.in";
export const SOCIAL_IMAGE = `${SITE_URL}/social-card.svg`;
export const SOCIAL_IMAGE_ALT = "CampusPilot — one connected operating system for modern schools";

export const landingRoutes = [
  ["/", "School Management Software for India | CampusPilot", "CampusPilot is an AI-ready school management platform for admissions, academics, fees, examinations, documents, dashboards, and student access."],
] as const;

export type LandingPath = (typeof landingRoutes)[number][0];

/** Builds the complete, route-specific metadata set used by every public page. */
export function createMeta(path: LandingPath) {
  const route = landingRoutes.find(([candidate]) => candidate === path);
  if (!route) throw new Error(`Missing SEO metadata for ${path}`);
  const [, title, description] = route;
  const canonical = path === "/" ? SITE_URL : `${SITE_URL}${path}`;

  return [
    { title },
    { name: "description", content: description },
    { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" },
    { tagName: "link", rel: "canonical", href: canonical },
    { property: "og:type", content: "website" },
    { property: "og:locale", content: "en_IN" },
    { property: "og:site_name", content: "CampusPilot" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: canonical },
    { property: "og:image", content: SOCIAL_IMAGE },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: SOCIAL_IMAGE_ALT },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: SOCIAL_IMAGE },
    ...(path === "/" ? [{ "script:ld+json": structuredData }] : []),
  ];
}

export const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${SITE_URL}/#organization`, name: "CampusPilot", url: SITE_URL, logo: `${SITE_URL}/icon.svg`, areaServed: { "@type": "Country", name: "India" } },
    { "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: "CampusPilot", url: SITE_URL, inLanguage: "en-IN", publisher: { "@id": `${SITE_URL}/#organization` } },
    { "@type": "SoftwareApplication", "@id": `${SITE_URL}/#software`, name: "CampusPilot", url: `${SITE_URL}/product`, applicationCategory: "EducationalApplication", applicationSubCategory: "School management software", operatingSystem: "Web", inLanguage: "en-IN", provider: { "@id": `${SITE_URL}/#organization` } },
  ],
};

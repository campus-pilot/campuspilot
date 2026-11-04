import { env } from "@campuspilot/env/web";

import { absoluteUrl, SITE_LANGUAGE, SITE_LOGO, SITE_NAME, SITE_URL } from "@/site/seo";
import type { FaqEntry } from "@/site/ui/faq";

const organizationId = `${SITE_URL}/#organization`;
const websiteId = `${SITE_URL}/#website`;

/**
 * Site-wide entities for the home page: who publishes the site (Organization,
 * with the same contact channels as /contact), the site itself (WebSite, which
 * Google uses for the site name shown above results) and the product
 * (SoftwareApplication). Other pages reference these through `@id`.
 */
export function createHomeStructuredData(faqs: readonly FaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: SITE_NAME,
        url: SITE_URL,
        logo: { "@type": "ImageObject", url: SITE_LOGO, width: 512, height: 512 },
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "sales",
          email: env.VITE_CONTACT_EMAIL,
          telephone: env.VITE_CONTACT_PHONE_NUMBER,
          url: absoluteUrl("/contact"),
        },
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        name: SITE_NAME,
        url: SITE_URL,
        inLanguage: SITE_LANGUAGE,
        publisher: { "@id": organizationId },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#software`,
        name: SITE_NAME,
        url: absoluteUrl("/product"),
        applicationCategory: "EducationalApplication",
        applicationSubCategory: "School management software",
        operatingSystem: "Web",
        inLanguage: SITE_LANGUAGE,
        description:
          "An AI-ready school management platform connecting admissions, academics, billing, examinations, documents, dashboards, and student access.",
        featureList: [
          "Admissions and student records",
          "Academic operations",
          "School fee management and student ledgers",
          "Examinations, results, and report cards",
          "Branded school document generation",
          "Role-aware dashboards and student access",
          "AI assistants that follow the same permissions as the person asking",
        ],
        provider: { "@id": organizationId },
      },
      {
        "@type": "FAQPage",
        "@id": `${SITE_URL}/#faq`,
        isPartOf: { "@id": websiteId },
        mainEntity: faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
      },
    ],
  };
}

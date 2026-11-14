// Relative on purpose: `react-router.config.ts` imports this module, and the config loader has no `@/` alias.
import { featureData, solutionData, type FeatureSlug, type SolutionSlug } from "./content/catalog";

export const SITE_URL = "https://campuspilot.in";
export const SITE_NAME = "CampusPilot";
/** Plain `en` (no region): the site is for schools anywhere, not one country. */
export const SITE_LANGUAGE = "en";
/** Raster logo for structured data: Google wants a crawlable bitmap of at least 112 px. */
export const SITE_LOGO = `${SITE_URL}/app-icon-512.png`;

/** Social cards are 1200 × 630 PNGs, the size every major preview (WhatsApp, LinkedIn, X, Slack) expects. */
export const SOCIAL_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/**
 * Copy for a route's social card. `lead` and `accent` are the two lines of the
 * page's own hero headline (the accent renders in the lighter tone, as on the
 * page), so a shared link previews exactly what the visitor lands on.
 */
export type SocialCard = {
  eyebrow: string;
  lead: string;
  accent: string;
};

export type SeoRoute = {
  path: string;
  /** Short page name used as the breadcrumb label in structured data. */
  name: string;
  title: string;
  description: string;
  card: SocialCard;
};

function featureCard(slug: FeatureSlug): SocialCard {
  const { eyebrow, title, accent } = featureData[slug];
  return { eyebrow, lead: title, accent };
}

function solutionCard(slug: SolutionSlug): SocialCard {
  const { eyebrow, title, accent } = solutionData[slug];
  return { eyebrow, lead: title, accent };
}

/**
 * Every indexable public route, in sitemap order. This list is the single
 * source for page metadata, `sitemap.xml`, the prerendered paths and the
 * generated social cards, so adding a public page means adding it here.
 * Feature and solution cards read their headline from the content catalog the
 * detail pages render, so the card cannot drift from the page.
 */
export const seoRoutes = [
  { path: "/", name: "Home", title: "School Management Software for All Schools | CampusPilot", description: "CampusPilot is an AI-ready school management platform for admissions, academics, fees, examinations, documents, dashboards, and student access.", card: { eyebrow: "School management software for all schools", lead: "School admin, done once.", accent: "Ready for AI." } },
  { path: "/product", name: "Product", title: "Connected School ERP Software | CampusPilot", description: "Run admissions, academics, school fees, examinations, documents, dashboards, and student access through one connected school ERP platform.", card: { eyebrow: "The product", lead: "One platform for every step,", accent: "from admission to year-end." } },
  { path: "/features", name: "Features", title: "School Management Software Features | CampusPilot", description: "Explore connected school ERP features for admissions, academics, fee management, examinations, documents, dashboards, and student access.", card: { eyebrow: "Features", lead: "One platform.", accent: "Every essential workflow." } },
  { path: "/features/admissions", name: "Admissions", title: "School Admission Management Software | CampusPilot", description: "Manage school enquiries, registrations, class allocation, and complete student records in one connected admission workflow.", card: featureCard("admissions") },
  { path: "/features/academics", name: "Academics", title: "School Academic Management Software | CampusPilot", description: "Organize academic sessions, classes, sections, subjects, attendance settings, and teacher assignments in one school platform.", card: featureCard("academics") },
  { path: "/features/billing", name: "Billing", title: "School Fee Management Software | CampusPilot", description: "Configure school fee structures, generate bills, record payments and discounts, issue receipts, and maintain transparent student ledgers.", card: featureCard("billing") },
  { path: "/features/examinations", name: "Examinations", title: "School Examination and Result Software | CampusPilot", description: "Plan school examinations, publish timetables, enter marks, manage approvals, and generate report cards and admit cards.", card: featureCard("examinations") },
  { path: "/features/documents", name: "Documents", title: "School Document and Certificate Software | CampusPilot", description: "Generate branded report cards, ID cards, admit cards, timetables, bills, receipts, and notices from live school records.", card: featureCard("documents") },
  { path: "/features/dashboards", name: "Dashboards", title: "School ERP Dashboards and Reports | CampusPilot", description: "See admissions, staffing, examinations, billing, and finance signals in role-aware school dashboards without parallel spreadsheets.", card: featureCard("dashboards") },
  { path: "/features/student-portal", name: "Student portal", title: "Secure Student Portal for Schools | CampusPilot", description: "Give students and families secure, mobile-friendly access to personal results, timetables, fee ledgers, notices, and academic information.", card: featureCard("student-portal") },
  { path: "/features/question-papers", name: "Question papers", title: "AI Question Paper Generator for Schools | CampusPilot", description: "Turn a teacher's handwritten paper or a short description into a printed question paper on your school's letterhead, drafted by AI and refined in chat.", card: featureCard("question-papers") },
  { path: "/features/notices", name: "Notices", title: "School Notices on App, WhatsApp and Push | CampusPilot", description: "Write a school notice once and deliver it to staff and students in the app, on WhatsApp and as a push notification, with a delivery log and print copies.", card: featureCard("notices") },
  { path: "/solutions", name: "Solutions", title: "School ERP Solutions for Every Team | CampusPilot", description: "Explore connected school management solutions for leaders, administrators, finance teams, examination teams, and campus groups.", card: { eyebrow: "Solutions", lead: "One operating system.", accent: "The right view for every role." } },
  { path: "/solutions/school-leaders", name: "School leaders", title: "School Management Software for Leaders | CampusPilot", description: "Give principals and school leaders a connected view of admissions, staffing, academics, examinations, and fee collection.", card: solutionCard("school-leaders") },
  { path: "/solutions/administrators", name: "Administrators", title: "School ERP for Administrators | CampusPilot", description: "Keep student journeys, academic setup, staff access, school documents, and daily administration moving in one platform.", card: solutionCard("administrators") },
  { path: "/solutions/teachers", name: "Teachers", title: "School Management Software for Teachers | CampusPilot", description: "Give teachers focused access to assigned classes, sections, attendance, marks, and examination work.", card: solutionCard("teachers") },
  { path: "/solutions/finance-teams", name: "Finance teams", title: "School Fee Software for Finance Teams | CampusPilot", description: "Help school finance teams manage fee rules, bills, payments, discounts, receipts, collection progress, and student ledgers.", card: solutionCard("finance-teams") },
  { path: "/solutions/exam-teams", name: "Examination teams", title: "School Examination Software for Exam Teams | CampusPilot", description: "Coordinate school exam plans, timetables, marks, attendance, result approvals, report cards, and admit cards in one workflow.", card: solutionCard("exam-teams") },
  { path: "/solutions/single-campus", name: "Single campus", title: "School ERP for Single-Campus Schools | CampusPilot", description: "Replace disconnected tools with one dependable school management system for admissions, academics, finance, examinations, and documents.", card: solutionCard("single-campus") },
  { path: "/solutions/multi-campus", name: "Multi-campus", title: "Multi-Campus School Management Software | CampusPilot", description: "Manage multiple schools from one account while keeping each campus's records, branding, sessions, roles, and permissions separate.", card: solutionCard("multi-campus") },
  { path: "/ai-ready", name: "AI ready", title: "AI-Ready School Management Software | CampusPilot", description: "Let the AI assistants your team already uses answer from live CampusPilot records, with the same campus, role and class permissions as the person asking.", card: { eyebrow: "AI readiness", lead: "Your school records,", accent: "ready for AI." } },
  { path: "/security", name: "Security", title: "School Data Security and Role Permissions | CampusPilot", description: "Understand CampusPilot's school isolation, role permissions, teacher scopes, separate student access, and AI assistants that follow the same permissions.", card: { eyebrow: "Security and permissions", lead: "The right access for every", accent: "campus, role, class and section." } },
  { path: "/contact", name: "Contact", title: "Contact CampusPilot for Your School ERP Requirements", description: "Discuss your school's campus setup, student strength, fee structure, examination workflows, documents, and operational priorities.", card: { eyebrow: "Contact", lead: "Reach us the way", accent: "you already work." } },
  { path: "/book-demo", name: "Book a demo", title: "Book a School Management Software Demo | CampusPilot", description: "Book a guided CampusPilot demo by phone, WhatsApp, email, or calendar and explore the workflows that matter to your school.", card: { eyebrow: "Book a demo", lead: "Book a demo", accent: "built around your school." } },
  { path: "/documentation", name: "Documentation", title: "CampusPilot Documentation | Coming Soon", description: "CampusPilot product documentation, implementation guidance, and workflow references are coming soon.", card: { eyebrow: "Documentation", lead: "Guides are on the way.", accent: "Here's what's coming." } },
  { path: "/privacy", name: "Privacy policy", title: "Privacy Policy | CampusPilot", description: "How CampusPilot collects, uses, stores and protects personal data of schools, staff, students and families, under the Digital Personal Data Protection Act, 2023.", card: { eyebrow: "Privacy policy", lead: "Your school's data,", accent: "handled with care." } },
  { path: "/terms", name: "Terms of use", title: "Terms of Use | CampusPilot", description: "The terms that apply when a school, its staff, students and families use CampusPilot.", card: { eyebrow: "Terms of use", lead: "The terms for using", accent: "CampusPilot." } },
] as const satisfies readonly SeoRoute[];

/** Utility pages that render normally but must stay out of search results and the sitemap. */
const privateRoutes = [
  { path: "/dashboard", title: "CampusPilot workspace", description: "The CampusPilot workspace lives in the management app." },
  { path: "/404", title: "Page not found | CampusPilot", description: "The page you were looking for could not be found." },
] as const;

export type IndexedPath = (typeof seoRoutes)[number]["path"];
export type SitePath = IndexedPath | (typeof privateRoutes)[number]["path"];

/** Absolute URL for a site path; the home page is canonical without a trailing slash. */
export function absoluteUrl(path: string) {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}

/**
 * Public path of a route's generated social card, served by the `og.$` resource
 * route and written to `build/client/og/…` at build time. The home card is
 * `/og/home.png`, every other route mirrors its own path.
 */
export function socialImagePath(path: IndexedPath) {
  return `/og${path === "/" ? "/home" : path}.png`;
}

/** Looks up the indexed route whose social card lives at `imagePath` (see `socialImagePath`). */
export function findRouteBySocialImage(imagePath: string) {
  return seoRoutes.find((route) => socialImagePath(route.path) === imagePath);
}

/**
 * Home → section → page trail for nested routes. The site's URL hierarchy is
 * its navigation hierarchy (`/features/billing` sits under `/features`), so the
 * trail follows the path segments. Top-level pages get Home → page.
 */
function breadcrumbs(route: SeoRoute) {
  const segments = route.path.split("/").filter(Boolean);
  const trail = segments.map((_, index) => `/${segments.slice(0, index + 1).join("/")}`);
  const items = ["/", ...trail]
    .map((path) => seoRoutes.find((candidate) => candidate.path === path))
    .filter((candidate): candidate is (typeof seoRoutes)[number] => candidate !== undefined);

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

const INDEXED_ROBOTS = "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";

/**
 * Builds the full, route-specific metadata set: title, description, robots,
 * canonical, Open Graph, Twitter and (below the home page) a BreadcrumbList.
 * Private routes are `noindex` and share the home social card.
 */
export function createMeta(path: SitePath) {
  const indexed = seoRoutes.find((candidate) => candidate.path === path);
  const route = indexed ?? privateRoutes.find((candidate) => candidate.path === path);
  if (!route) throw new Error(`Missing SEO metadata for ${path}`);
  const { title, description } = route;
  const canonical = absoluteUrl(path);
  const card = indexed?.card ?? seoRoutes[0].card;
  const image = absoluteUrl(socialImagePath(indexed?.path ?? "/"));
  const imageAlt = `${card.lead} ${card.accent} — ${SITE_NAME}`;

  return [
    { title },
    { name: "description", content: description },
    { name: "robots", content: indexed ? INDEXED_ROBOTS : "noindex, follow" },
    { tagName: "link", rel: "canonical", href: canonical },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: canonical },
    { property: "og:image", content: image },
    { property: "og:image:secure_url", content: image },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: String(SOCIAL_IMAGE_SIZE.width) },
    { property: "og:image:height", content: String(SOCIAL_IMAGE_SIZE.height) },
    { property: "og:image:alt", content: imageAlt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: imageAlt },
    ...(indexed && indexed.path !== "/" ? [{ "script:ld+json": breadcrumbs(indexed) }] : []),
  ];
}

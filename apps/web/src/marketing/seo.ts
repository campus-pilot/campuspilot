export const SITE_URL = "https://campuspilot.in";
export const SOCIAL_IMAGE = `${SITE_URL}/social-card.svg`;
export const SOCIAL_IMAGE_ALT = "CampusPilot — one connected operating system for modern schools";

export const landingRoutes = [
  ["/", "School Management Software for India | CampusPilot", "CampusPilot is an AI-ready school management platform for admissions, academics, fees, examinations, documents, dashboards, and student access."],
  ["/product", "Connected School ERP Software for India | CampusPilot", "Run admissions, academics, school fees, examinations, documents, dashboards, and student access through one connected school ERP platform."],
  ["/features", "School Management Software Features | CampusPilot", "Explore connected school ERP features for admissions, academics, fee management, examinations, documents, dashboards, and student access."],
  ["/features/admissions", "School Admission Management Software | CampusPilot", "Manage school enquiries, registrations, class allocation, and complete student records in one connected admission workflow."],
  ["/features/academics", "School Academic Management Software | CampusPilot", "Organize academic sessions, classes, sections, subjects, attendance settings, and teacher assignments in one school platform."],
  ["/features/billing", "School Fee Management Software | CampusPilot", "Configure school fee structures, generate bills, record payments and discounts, issue receipts, and maintain transparent student ledgers."],
  ["/features/examinations", "School Examination and Result Software | CampusPilot", "Plan school examinations, publish timetables, enter marks, manage approvals, and generate report cards and admit cards."],
  ["/features/documents", "School Document and Certificate Software | CampusPilot", "Generate branded report cards, ID cards, admit cards, timetables, bills, receipts, and notices from live school records."],
  ["/features/dashboards", "School ERP Dashboards and Reports | CampusPilot", "See admissions, staffing, examinations, billing, and finance signals in role-aware school dashboards without parallel spreadsheets."],
  ["/features/student-portal", "Secure Student Portal for Schools | CampusPilot", "Give students and families secure, mobile-friendly access to personal results, timetables, fee ledgers, notices, and academic information."],
  ["/solutions", "School ERP Solutions for Every Team | CampusPilot", "Explore connected school management solutions for leaders, administrators, finance teams, examination teams, and campus groups."],
  ["/solutions/school-leaders", "School Management Software for Leaders | CampusPilot", "Give principals and school leaders a connected view of admissions, staffing, academics, examinations, and fee collection."],
  ["/solutions/administrators", "School ERP for Administrators | CampusPilot", "Keep student journeys, academic setup, staff access, school documents, and daily administration moving in one platform."],
  ["/solutions/teachers", "School Management Software for Teachers | CampusPilot", "Give teachers focused access to assigned classes, sections, attendance, marks, and examination work."],
  ["/solutions/finance-teams", "School Fee Software for Finance Teams | CampusPilot", "Help school finance teams manage fee rules, bills, payments, discounts, receipts, collection progress, and student ledgers."],
  ["/solutions/exam-teams", "School Examination Software for Exam Teams | CampusPilot", "Coordinate school exam plans, timetables, marks, attendance, result approvals, report cards, and admit cards in one workflow."],
  ["/solutions/single-campus", "School ERP for Single-Campus Schools | CampusPilot", "Replace disconnected tools with one dependable school management system for admissions, academics, finance, examinations, and documents."],
  ["/solutions/multi-campus", "Multi-Campus School Management Software | CampusPilot", "Manage multiple schools from one account while keeping each campus's records, branding, sessions, roles, and permissions separate."],
  ["/ai-ready", "AI-Ready School ERP and MCP Platform | CampusPilot", "Connect compatible AI assistants to authorized school workflows through native MCP while preserving campus, role, and teacher permissions."],
  ["/security", "School Data Security and Role Permissions | CampusPilot", "Understand CampusPilot's school isolation, role permissions, teacher scopes, separate student access, and permission-aware AI connections."],
  ["/contact", "Contact CampusPilot for Your School ERP Requirements", "Discuss your school's campus setup, student strength, fee structure, examination workflows, documents, and operational priorities."],
  ["/book-demo", "Book a School Management Software Demo | CampusPilot", "Book a guided CampusPilot demo by phone, WhatsApp, email, or calendar and explore the workflows that matter to your school."],
  ["/documentation", "CampusPilot Documentation | Coming Soon", "CampusPilot product documentation, implementation guidance, and workflow references are coming soon."],
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

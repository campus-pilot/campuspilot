import {
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  CreditCard,
  FilePenLine,
  FileText,
  Fingerprint,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  Megaphone,
  School,
  Settings2,
  ShieldCheck,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Public-site content ported from the previous marketing catalog
 * (main checkout: apps/web/src/marketing/catalog.tsx). Plain data only, so
 * any page can render it its own way. Page agents may enrich their own copy,
 * but keep these facts as the source of truth for what the product does.
 */
export type FeatureSlug = "admissions" | "academics" | "billing" | "examinations" | "documents" | "dashboards" | "student-portal" | "question-papers" | "notices";
export type SolutionSlug = "school-leaders" | "administrators" | "teachers" | "finance-teams" | "exam-teams" | "single-campus" | "multi-campus";

export type DetailData = {
  eyebrow: string;
  title: string;
  accent: string;
  description: string;
  outcomes: readonly { title: string; text: string }[];
  steps: readonly string[];
  spotlightTitle: string;
  spotlightText: string;
  bullets: readonly string[];
};

export type DirectoryEntry = {
  icon: LucideIcon;
  title: string;
  text: string;
  href: string;
};

export type ValueItem = {
  icon: LucideIcon;
  title: string;
  text: string;
};

export const featureData: Record<FeatureSlug, DetailData> = {
  admissions: { eyebrow: "Admissions and student records", title: "Turn every new enquiry into", accent: "a confident beginning.", description: "Capture applicants, guide registration, and create complete student records without re-entering the same information at every step.", outcomes: [{ title: "Capture the full enquiry", text: "Keep contact details, class interest, notes, and registration status together from the first conversation." }, { title: "Move from applicant to student", text: "Convert a confirmed admission into an active record once class, section, and academic session are assigned." }, { title: "Carry context forward", text: "The resulting student record is ready for classrooms, billing, examinations, documents, and student access." }], steps: ["Capture enquiry", "Complete registration", "Assign class and session", "Activate student record"], spotlightTitle: "One record, from first interest onward.", spotlightText: "Admissions do not end at registration. CampusPilot carries reliable student context into every workflow that follows.", bullets: ["Applicant and guardian details", "Registration status and class interest", "Direct conversion to active student", "Session-aware student records"] },
  academics: { eyebrow: "Academic operations", title: "Build a school structure that", accent: "matches the way you teach.", description: "Organize academic sessions, classes, subjects, sections, staff assignments, grading, and attendance with a clear operational foundation.", outcomes: [{ title: "Session-aware organization", text: "Keep each academic year distinct while preserving the records and configuration that belong to it." }, { title: "Clear classroom structure", text: "Connect classes, sections, subjects, and students in a dependable academic model." }, { title: "Teacher-aware access", text: "Assign educators to the right classes and sections so their access follows their actual responsibility." }], steps: ["Create session", "Configure classes", "Build sections", "Assign teachers"], spotlightTitle: "A strong foundation for every academic workflow.", spotlightText: "Once the school structure is accurate, examinations, reporting, permissions, and student access become easier to operate.", bullets: ["Classes, subjects, and sections", "Teacher and class-teacher assignments", "Grading and attendance configuration", "Guided school setup"] },
  billing: { eyebrow: "Finance and billing", title: "Flexible school billing,", accent: "without the spreadsheet maze.", description: "Configure real fee structures, generate bills in bulk or individually, record payments and discounts, and keep a transparent student ledger.", outcomes: [{ title: "Model real fee structures", text: "Build fee rules around the hierarchy, periods, and school-specific elements your institution actually uses." }, { title: "Bill with control", text: "Generate monthly or individual bills, review billing events, and keep every amount tied to its session context." }, { title: "Make every payment traceable", text: "Record payments and discounts, create receipts, and give authorized teams a dependable ledger." }], steps: ["Configure fees", "Generate bills", "Record payment", "Issue receipt"], spotlightTitle: "See billed, collected, and outstanding—together.", spotlightText: "Finance teams get a consistent picture of collection progress without assembling separate reports.", bullets: ["Hierarchical fee configuration", "Bulk and individual billing", "Payments, discounts, and receipts", "Student ledger and collection dashboard"] },
  examinations: { eyebrow: "Examinations and results", title: "Move every examination from plan", accent: "to approved result.", description: "Coordinate exam plans, timetables, marks, attendance, approvals, report cards, and admit cards through one controlled lifecycle.", outcomes: [{ title: "Plan with a clear status", text: "Create exam plans and move them through active, completed, and approved states with confidence." }, { title: "Coordinate the detail", text: "Build timetables, manage subject-level marks and attendance, and track result progress by class." }, { title: "Publish polished outcomes", text: "Approve results and generate consistent report cards and admit cards from the same records." }], steps: ["Create exam plan", "Publish timetable", "Enter results", "Approve and generate"], spotlightTitle: "Progress stays visible from setup to sign-off.", spotlightText: "Exam teams can see what is active, what is complete, and exactly where result entry still needs attention.", bullets: ["Controlled examination statuses", "Timetables, marks, and attendance", "Co-scholastic grades and approvals", "Report cards and admit cards"] },
  documents: { eyebrow: "Documents and school branding", title: "Turn live records into", accent: "school-ready documents.", description: "Create branded report cards, ID cards, admit cards, timetables, bills, receipts, and notices without rebuilding every document by hand.", outcomes: [{ title: "Start with dependable templates", text: "Use built-in templates for common school documents and preview them with realistic context." }, { title: "Make the output your own", text: "Adapt templates to reflect school branding, layout expectations, and operational needs." }, { title: "Generate at school scale", text: "Produce polished PDFs individually or in bulk, with version awareness when source data changes." }], steps: ["Choose template", "Apply school branding", "Preview with live context", "Generate in bulk"], spotlightTitle: "Your data is already there. Your documents should be moments away.", spotlightText: "CampusPilot connects templates to current records so teams can focus on review and delivery, not repetitive formatting.", bullets: ["Built-in template marketplace", "Custom HTML templates", "Print-ready PDF generation", "Outdated and regeneration states"] },
  dashboards: { eyebrow: "Dashboards and decision support", title: "See the school’s pulse", accent: "without chasing updates.", description: "Bring enrollment, staffing, examinations, billing, and finance signals into clear operational views shaped around each role.", outcomes: [{ title: "Start with what matters now", text: "Surface recent activity, active plans, collection progress, and areas that need attention." }, { title: "Keep context attached", text: "Move from a high-level number to the operational records that explain it." }, { title: "Respect role boundaries", text: "Give leaders and teams useful visibility without exposing data outside their responsibility." }], steps: ["Connect workflows", "Aggregate signals", "Apply role visibility", "Act on context"], spotlightTitle: "Operational clarity, not another reporting chore.", spotlightText: "Dashboards reflect the work already happening across CampusPilot, helping teams respond without maintaining a parallel reporting system.", bullets: ["Enrollment and admissions signals", "Staffing and classroom snapshots", "Exam and result progress", "Billing and finance summaries"] },
  "question-papers": { eyebrow: "Question papers with AI", title: "From a handwritten draft to a", accent: "printed paper in minutes.", description: "A teacher photographs a handwritten paper, or describes it in chat, and CampusPilot's AI turns it into a clean question paper that prints on your school's own letterhead.", outcomes: [{ title: "Start the way teachers already work", text: "Upload photos of the handwritten paper, describe the paper to the assistant, or begin from an earlier paper of the same class and subject." }, { title: "Edit by talking to it", text: "Ask for changes in chat, with figures attached from your own images. Every change is saved as a new version, so nothing is overwritten." }, { title: "Print on your letterhead", text: "The heading and footer come from your school's template. Each version has its own PDF to preview and download." }], steps: ["Add photos or describe", "AI drafts the paper", "Review and refine in chat", "Download the PDF"], spotlightTitle: "AI writes the questions. Your school's template frames them.", spotlightText: "The AI only writes the body of the paper. The school name, heading and footer always come from your own template, and only teachers with access to that class can see or change its papers.", bullets: ["Hindi, Urdu and other Indian languages", "Mathematics typeset properly", "Figures from your own uploaded images", "Every version kept, each with a PDF"] },
  notices: { eyebrow: "Notices and notifications", title: "Say it once and reach", accent: "everyone who needs to know.", description: "Write a notice once, choose staff, students or selected classes, and CampusPilot delivers it in the app, on WhatsApp and as a push notification, with a printable copy for the notice board.", outcomes: [{ title: "Reach the right people", text: "Address a notice to staff, to every class, or only to the classes you pick. Students read it in their own portal." }, { title: "Delivered where people look", text: "Notices, bills, receipts, payments and published results arrive in the app, on WhatsApp and as push notifications." }, { title: "Know what was delivered", text: "A delivery log shows what went out on each channel, so a failed message can be resent instead of guessed at." }], steps: ["Write the notice", "Choose who it is for", "Review and publish", "Delivered and logged"], spotlightTitle: "One notice, three ways to arrive.", spotlightText: "Publishing sends the notice in the app, on WhatsApp and as a push notification to the people it is addressed to, and every notice can also be printed on full or half A4.", bullets: ["Staff, all classes or selected classes", "In-app, WhatsApp and push delivery", "Delivery log with resend", "Print on full or half A4"] },
  "student-portal": { eyebrow: "Student experience", title: "Give every student a view", accent: "that is truly their own.", description: "Provide secure, separate access to personal academic information through a responsive experience designed for students and families.", outcomes: [{ title: "Personal by default", text: "Each student sees only the records and documents that belong to their own school identity." }, { title: "Useful on any screen", text: "Responsive access keeps essential academic information practical on phones, tablets, and desktops." }, { title: "Connected to school operations", text: "Approved results, timetables, ledgers, and notices can flow from the same source staff already use." }], steps: ["Secure student sign-in", "Resolve school identity", "Show personal records", "Keep information current"], spotlightTitle: "A focused portal, separate from administration.", spotlightText: "Students get a calm, privacy-aware view without navigating the complexity of the staff workspace.", bullets: ["Separate student authentication", "Personal results and timetable access", "Student-specific privacy boundary", "Mobile-responsive experience"] },
};

export const solutionData: Record<SolutionSlug, DetailData> = {
  "school-leaders": { eyebrow: "For school leaders", title: "Lead with a connected view of", accent: "school operations.", description: "See admissions, staffing, academics, and collections across one connected operational system while giving each team the access it needs.", outcomes: [{ title: "Answers without assembly", text: "See important operational signals without waiting for another spreadsheet to be prepared." }, { title: "Consistent processes", text: "Keep teams working from the same dependable records and workflow states." }, { title: "Follow up with context", text: "Move from a signal to the school activity and records that explain it." }], steps: ["Connect workflows", "Surface signals", "Resolve context", "Act with confidence"], spotlightTitle: "The school-wide view, without losing the detail.", spotlightText: "Leaders receive broad school-level visibility while every protected action retains its campus and permission context.", bullets: ["Admissions and enrollment activity", "Staff and classroom snapshots", "Examination and result progress", "Billed, collected, and outstanding totals"] },
  administrators: { eyebrow: "For administrators", title: "Keep every student journey", accent: "moving.", description: "Manage student journeys, academic structures, school setup, staff access, and bulk documents without maintaining separate records in multiple tools.", outcomes: [{ title: "Less duplicate entry", text: "Capture information once and carry it into the workflows that follow." }, { title: "Dependable records", text: "Keep class, section, session, and student context organized from day one." }, { title: "Repeatable operations", text: "Use guided setup and document workflows that teams can run consistently." }], steps: ["Capture records", "Complete setup", "Coordinate teams", "Generate outputs"], spotlightTitle: "The workflows that keep school days moving.", spotlightText: "Administrators can coordinate broadly while teacher access remains limited to assigned classes and sections.", bullets: ["Admission registration and conversion", "Sessions, classes, and sections", "Staff invitations and teacher scopes", "Bulk ID, admit, and report-card generation"] },
  teachers: { eyebrow: "For teachers", title: "Keep classroom work", accent: "focused and in scope.", description: "Give teachers direct access to the classes, sections, subjects, attendance, and result work they are responsible for—without exposing the rest of the school.", outcomes: [{ title: "Assigned work only", text: "Teachers enter through the classes and sections connected to their current responsibilities." }, { title: "Less navigation", text: "Attendance, marks, and academic context stay close to the classroom." }, { title: "Clear handoffs", text: "Completed work moves into examination review and student-facing outcomes." }], steps: ["Resolve assignment", "Open classroom", "Complete academic work", "Submit for review"], spotlightTitle: "A focused view of the work that belongs to each teacher.", spotlightText: "Assignment-based access keeps the workspace useful and the permission boundary explicit.", bullets: ["Class and section assignments", "Subject-aware academic work", "Attendance and marks entry", "Controlled examination handoffs"] },
  "finance-teams": { eyebrow: "For finance teams", title: "Make every fee rule, payment, and balance", accent: "easier to trace.", description: "Work with flexible fee rules, period-based billing, individual adjustments, payments, discounts, ledgers, and printable receipts from one workflow.", outcomes: [{ title: "More accurate collections", text: "Use explicit fee rules and billing periods instead of rebuilding calculations each cycle." }, { title: "Fewer manual exceptions", text: "Handle class and student differences within the same structured model." }, { title: "Transparent history", text: "Keep bills, discounts, payments, balances, and receipts together per student." }], steps: ["Configure rules", "Review billing", "Post payments", "Reconcile ledger"], spotlightTitle: "Finance with an audit-friendly history.", spotlightText: "Financial procedures remain available only to authorized roles, with the active school and session attached to every action.", bullets: ["School, session, class, and student fee rules", "Monthly, quarterly, and yearly billing", "Payments, discounts, and printable receipts", "Student ledger and collection dashboards"] },
  "exam-teams": { eyebrow: "For examination teams", title: "Turn exam season into", accent: "one controlled workflow.", description: "Manage exam plans, assessment modes, timetables, result status, and official examination documents with a controlled end-to-end process.", outcomes: [{ title: "A calmer exam season", text: "See each plan’s status and coordinate the next action without scattered trackers." }, { title: "Consistent processing", text: "Keep marks, attendance, co-scholastics, and approvals in one governed lifecycle." }, { title: "Professional outputs", text: "Generate admit cards, timetables, and report cards from approved records." }], steps: ["Plan", "Schedule", "Enter results", "Approve outputs"], spotlightTitle: "Progress stays visible from plan to publication.", spotlightText: "Teachers work inside assigned classes and valid plans; examination coordinators retain workflow control and review.", bullets: ["Session, class, subject, and exam plans", "Written, practical, and viva modes", "Timetables, marks, attendance, and approvals", "Admit cards and report cards"] },
  "single-campus": { eyebrow: "For single-campus schools", title: "Bring the whole school into", accent: "one dependable operation.", description: "Replace disconnected tools with a consistent source of truth for admissions, academics, finance, examinations, documents, and student access.", outcomes: [{ title: "One source of truth", text: "Give every authorized team current records without maintaining parallel files." }, { title: "A practical rollout", text: "Start with the structure and workflows that matter most to your school." }, { title: "Room to evolve", text: "Add deeper workflows and connected AI capabilities without replacing the foundation." }], steps: ["Set up school", "Invite teams", "Connect workflows", "Operate with clarity"], spotlightTitle: "One school. One shared operational foundation.", spotlightText: "A connected platform removes handoff friction while keeping each team focused on the work it owns.", bullets: ["Guided school and session setup", "Shared student and academic context", "Role-appropriate team workspaces", "Branded school documents"] },
  "multi-campus": { eyebrow: "For growing institutions", title: "Grow across campuses without", accent: "blurring their boundaries.", description: "Users associated with more than one school can work from one account and choose the appropriate campus context, while local records and permissions remain separate.", outcomes: [{ title: "Campus-specific setup", text: "Keep sessions, classes, finance rules, templates, and branding appropriate to each campus." }, { title: "Local boundaries", text: "Records and permissions stay isolated even when a person can access more than one school." }, { title: "A consistent operating model", text: "Give every campus the same dependable workflow foundation as the institution expands." }], steps: ["Choose campus", "Resolve local role", "Work in context", "Switch securely"], spotlightTitle: "Connected does not mean exposed.", spotlightText: "Switching campus changes the active context; it does not merge local records or permissions.", bullets: ["Campus selection from one account", "Separate local records and configuration", "Campus-aware roles and permissions", "Local templates and school branding"] },
};

export function isFeatureSlug(slug: string | undefined): slug is FeatureSlug {
  return slug !== undefined && Object.hasOwn(featureData, slug);
}

export function isSolutionSlug(slug: string | undefined): slug is SolutionSlug {
  return slug !== undefined && Object.hasOwn(solutionData, slug);
}

export const featureDirectory: readonly DirectoryEntry[] = [
  { icon: Users, title: "Admissions", text: "Move from enquiry to a complete student record.", href: "/features/admissions" },
  { icon: GraduationCap, title: "Academic operations", text: "Organize sessions, classes, sections, and teachers.", href: "/features/academics" },
  { icon: CreditCard, title: "Finance and billing", text: "Configure fees, collect payments, and keep clear ledgers.", href: "/features/billing" },
  { icon: BookOpen, title: "Examinations", text: "Coordinate plans, results, approvals, and report cards.", href: "/features/examinations" },
  { icon: FileText, title: "Documents", text: "Generate branded school documents from live records.", href: "/features/documents" },
  { icon: BarChart3, title: "Dashboards", text: "See role-appropriate operational signals in context.", href: "/features/dashboards" },
  { icon: FilePenLine, title: "Question papers", text: "Turn handwritten drafts into printed papers with AI.", href: "/features/question-papers" },
  { icon: Megaphone, title: "Notices & notifications", text: "Reach staff and students in the app, on WhatsApp and by push.", href: "/features/notices" },
  { icon: LayoutDashboard, title: "Student portal", text: "Give students a secure view of their information.", href: "/features/student-portal" },
  { icon: ShieldCheck, title: "Security", text: "Keep roles, teachers, students, and campuses in bounds.", href: "/security" },
];

export const solutionDirectory: readonly DirectoryEntry[] = [
  { icon: BarChart3, title: "School leaders", text: "See admissions, staffing, academics, and collections together.", href: "/solutions/school-leaders" },
  { icon: Settings2, title: "Administrators", text: "Keep student journeys, setup, access, and documents moving.", href: "/solutions/administrators" },
  { icon: GraduationCap, title: "Teachers", text: "Focus on assigned classes, sections, and academic work.", href: "/solutions/teachers" },
  { icon: CreditCard, title: "Finance teams", text: "Trace every fee rule, payment, discount, and balance.", href: "/solutions/finance-teams" },
  { icon: BookOpen, title: "Examination teams", text: "Control plans, timetables, results, and official documents.", href: "/solutions/exam-teams" },
  { icon: School, title: "Single campus", text: "Bring the whole school into one dependable operation.", href: "/solutions/single-campus" },
  { icon: Building2, title: "Multi-campus", text: "Grow across campuses without blurring their boundaries.", href: "/solutions/multi-campus" },
];

/** Old wording names the protocol ("MCP"); public copy must describe it in business terms instead. */
export const securityItems: readonly ValueItem[] = [
  { icon: School, title: "Isolated school tenants", text: "Each school keeps its own sessions, classes, students, staff, finance settings, templates, and branding within its data boundary." },
  { icon: UserCheck, title: "Role-based permissions", text: "Administrators, managers, accountants, exam coordinators, and teachers receive access around their responsibilities." },
  { icon: Fingerprint, title: "Assignment-based teacher scopes", text: "Protected academic work can be limited to the classes and sections assigned to each teacher." },
  { icon: LockKeyhole, title: "Separate student access", text: "Student sessions are recognized independently and portal requests are restricted to the authenticated student’s own information." },
  { icon: KeyRound, title: "Controlled connections", text: "Session authentication serves the application while API keys support authorized connected tools and services." },
  { icon: ShieldCheck, title: "Permission-aware MCP", text: "The application API and native MCP connection apply the same authorization boundaries to protected operations." },
];

/** Old wording names the protocol ("MCP"); public copy must describe it in business terms instead. */
export const aiItems: readonly ValueItem[] = [
  { icon: Bot, title: "Connect compatible assistants", text: "Use a standard MCP endpoint to connect supported copilots or purpose-built agents to CampusPilot operations." },
  { icon: Settings2, title: "Extend without parallel integrations", text: "Registered platform procedures can become structured MCP tools as capabilities are added." },
  { icon: Fingerprint, title: "Keep permissions in force", text: "Campus boundaries, staff roles, finance permissions, and teacher scopes remain attached to protected requests." },
  { icon: LockKeyhole, title: "Build responsibly", text: "CampusPilot enables authorized assistants to help with work; it does not claim unsupervised decisions or record changes." },
];

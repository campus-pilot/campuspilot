import {
  Bot,
  BookOpenCheck,
  Briefcase,
  Building2,
  Calculator,
  ChartColumn,
  ClipboardCheck,
  FilePenLine,
  FileText,
  GraduationCap,
  IndianRupee,
  LayoutDashboard,
  LayoutGrid,
  Library,
  Mail,
  Megaphone,
  MessageSquareText,
  NotebookPen,
  School,
  ShieldCheck,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

/**
 * Names of the hover micro-animations defined in `site/site.css` (`.cp-icon-<motion>`).
 * Each icon gets its own small, playful motion so the menus feel alive without
 * moving anything but the icon itself.
 */
export type IconMotion =
  | "bars"
  | "blink"
  | "books"
  | "bounce"
  | "flip"
  | "grid"
  | "lift"
  | "plus"
  | "pulse"
  | "rise"
  | "tap"
  | "toss"
  | "wiggle"
  | "write";

export type NavLinkItem = {
  description: string;
  href: string;
  icon: LucideIcon;
  label: string;
  motion: IconMotion;
};

export type NavGroup = {
  items: readonly NavLinkItem[];
  label: string;
};

export type NavMenu = {
  groups: readonly NavGroup[];
  id: string;
  label: string;
  /** Shows the dark question-paper spotlight card beside the link groups. */
  spotlight: boolean;
};

const productGroups: readonly NavGroup[] = [
  {
    label: "Daily operations",
    items: [
      { href: "/features/admissions", label: "Admissions", description: "Enquiry to student record", icon: UserPlus, motion: "plus" },
      { href: "/features/academics", label: "Academics", description: "Sessions, classes and teachers", icon: GraduationCap, motion: "toss" },
      { href: "/features/billing", label: "Finance & fees", description: "Bills, receipts and ledgers", icon: IndianRupee, motion: "flip" },
      { href: "/features/examinations", label: "Examinations", description: "Marks, approvals, report cards", icon: ClipboardCheck, motion: "wiggle" },
      { href: "/features/question-papers", label: "Question papers", description: "Handwritten draft to printed paper, with AI", icon: FilePenLine, motion: "write" },
    ],
  },
  {
    label: "Records & access",
    items: [
      { href: "/features/documents", label: "Documents", description: "Branded outputs from live records", icon: FileText, motion: "lift" },
      { href: "/features/notices", label: "Notices & notifications", description: "In the app, on WhatsApp and by push", icon: Megaphone, motion: "bounce" },
      { href: "/features/dashboards", label: "Dashboards", description: "The session at a glance", icon: ChartColumn, motion: "bars" },
      { href: "/features/student-portal", label: "Student & family access", description: "Each student sees only their own", icon: UsersRound, motion: "rise" },
      { href: "/product", label: "Platform overview", description: "How it all connects", icon: LayoutGrid, motion: "grid" },
    ],
  },
];

const solutionGroups: readonly NavGroup[] = [
  {
    label: "By team",
    items: [
      { href: "/solutions/school-leaders", label: "Principals & leaders", description: "The whole school, connected", icon: LayoutDashboard, motion: "grid" },
      { href: "/solutions/administrators", label: "Administrators", description: "Keep every school day moving", icon: Briefcase, motion: "bounce" },
      { href: "/solutions/teachers", label: "Teachers", description: "Only their assigned classes", icon: NotebookPen, motion: "write" },
      { href: "/solutions/finance-teams", label: "Finance teams", description: "Trace every rupee and balance", icon: Calculator, motion: "tap" },
      { href: "/solutions/exam-teams", label: "Examination teams", description: "Plan to approved result", icon: BookOpenCheck, motion: "books" },
    ],
  },
  {
    label: "By institution",
    items: [
      { href: "/solutions/single-campus", label: "Single-campus schools", description: "One dependable source of truth", icon: School, motion: "bounce" },
      { href: "/solutions/multi-campus", label: "Multi-campus groups", description: "Grow without blurring campuses", icon: Building2, motion: "rise" },
    ],
  },
];

const resourceGroups: readonly NavGroup[] = [
  {
    label: "Learn",
    items: [
      { href: "/ai-ready", label: "AI-ready", description: "Assistants within each person's access", icon: Bot, motion: "blink" },
      { href: "/security", label: "Security & permissions", description: "Campus, role and class boundaries", icon: ShieldCheck, motion: "pulse" },
      { href: "/documentation", label: "Documentation", description: "Product guidance, coming soon", icon: Library, motion: "books" },
    ],
  },
  {
    label: "Talk to us",
    items: [
      { href: "/book-demo", label: "Book a demo", description: "A walkthrough for your school", icon: MessageSquareText, motion: "write" },
      { href: "/contact", label: "Contact", description: "WhatsApp, call or email", icon: Mail, motion: "tap" },
    ],
  },
];

export const navMenus: readonly NavMenu[] = [
  { id: "product", label: "Product", groups: productGroups, spotlight: true },
  { id: "solutions", label: "Solutions", groups: solutionGroups, spotlight: false },
  { id: "resources", label: "Resources", groups: resourceGroups, spotlight: false },
];

/** Plain links shown beside the dropdown triggers. */
export const navLinks = [
  { href: "/features", label: "Features" },
  { href: "/ai-ready", label: "AI-ready" },
] as const;

import {
  Bot,
  Briefcase,
  Building2,
  Calculator,
  ChartColumn,
  ClipboardCheck,
  FileText,
  GraduationCap,
  IndianRupee,
  LayoutDashboard,
  Library,
  NotebookPen,
  School,
  ShieldCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

/**
 * Names of the hover micro-animations defined in `styles.css` (`.d1-icon-<motion>`).
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
  /** Shows the dark "AI-ready" spotlight card beside the link groups. */
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
    ],
  },
  {
    label: "Records & oversight",
    items: [
      { href: "/features/documents", label: "Documents", description: "Branded outputs from live records", icon: FileText, motion: "lift" },
      { href: "/features/dashboards", label: "Dashboards", description: "The session at a glance", icon: ChartColumn, motion: "bars" },
      { href: "/security", label: "Permissions", description: "Role, campus and class boundaries", icon: ShieldCheck, motion: "pulse" },
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
      { href: "/documentation", label: "Documentation", description: "Product guidance, coming soon", icon: Library, motion: "books" },
    ],
  },
];

export const navMenus: readonly NavMenu[] = [
  { id: "product", label: "Product", groups: productGroups, spotlight: true },
  { id: "solutions", label: "Solutions", groups: solutionGroups, spotlight: false },
  { id: "resources", label: "Resources", groups: resourceGroups, spotlight: false },
];

/** Plain in-page links shown beside the dropdown triggers. */
export const navAnchors = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#faq", label: "FAQ" },
] as const;

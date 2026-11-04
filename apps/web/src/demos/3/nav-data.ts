import {
  BookOpen,
  Building2,
  ChartColumn,
  CreditCard,
  FileText,
  GraduationCap,
  LayoutDashboard,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavLinkItem = {
  description: string;
  href: string;
  icon: LucideIcon;
  label: string;
};

export type NavGroup = {
  id: string;
  label: string;
  /** Hand-written margin note shown beside the links in the dropdown. */
  note: string;
  links: readonly NavLinkItem[];
};

export const productGroup: NavGroup = {
  id: "product",
  label: "Product",
  note: "Every module reads the same records — nothing gets typed twice.",
  links: [
    { href: "/features/admissions", label: "Admissions", description: "Enquiry to student record", icon: Users },
    { href: "/features/academics", label: "Academics", description: "Sessions, classes, subjects", icon: GraduationCap },
    { href: "/features/billing", label: "Fees & finance", description: "Bills, receipts, ledgers", icon: CreditCard },
    { href: "/features/examinations", label: "Examinations", description: "Marks, approvals, report cards", icon: BookOpen },
    { href: "/features/documents", label: "Documents", description: "Print-ready from live records", icon: FileText },
    { href: "/features/dashboards", label: "Dashboards", description: "The whole school at a glance", icon: LayoutDashboard },
  ],
};

export const solutionsGroup: NavGroup = {
  id: "solutions",
  label: "Solutions",
  note: "Different desks, same school underneath.",
  links: [
    { href: "/solutions/school-leaders", label: "Principals & leaders", description: "One honest view of the school", icon: ChartColumn },
    { href: "/solutions/administrators", label: "Office staff", description: "Daily operations, fewer registers", icon: LayoutDashboard },
    { href: "/solutions/teachers", label: "Teachers", description: "Only your assigned classes", icon: GraduationCap },
    { href: "/solutions/finance-teams", label: "Accounts team", description: "Trace every rupee", icon: CreditCard },
    { href: "/solutions/exam-teams", label: "Exam cell", description: "Plan to report card", icon: BookOpen },
    { href: "/solutions/multi-campus", label: "School groups", description: "Many campuses, clear boundaries", icon: Building2 },
  ],
};

export const navGroups = [productGroup, solutionsGroup] as const;

/** Top-level links without a dropdown. */
export const plainNavLinks: readonly NavLinkItem[] = [
  { href: "/ai-ready", label: "AI-ready", description: "Assistants that respect permissions", icon: Sparkles },
  { href: "/security", label: "Security", description: "Roles, campuses, classrooms", icon: ShieldCheck },
];

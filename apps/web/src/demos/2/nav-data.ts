import {
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  CreditCard,
  FileText,
  GraduationCap,
  LayoutDashboard,
  School,
  ShieldCheck,
  Users,
} from "lucide-react";

export type NavLink = {
  href: string;
  label: string;
  description: string;
  icon: typeof School;
};

export type NavMenu = {
  id: string;
  label: string;
  links: readonly NavLink[];
};

export const productLinks: readonly NavLink[] = [
  { href: "/features/admissions", label: "Admissions", description: "Enquiry to student record", icon: Users },
  { href: "/features/academics", label: "Academics", description: "Sessions, classes and teachers", icon: GraduationCap },
  { href: "/features/billing", label: "Fees & billing", description: "Bills, receipts and ledgers", icon: CreditCard },
  { href: "/features/examinations", label: "Examinations", description: "Plans, marks and approvals", icon: BookOpen },
  { href: "/features/documents", label: "Documents", description: "Report cards, admit cards, notices", icon: FileText },
  { href: "/features/dashboards", label: "Dashboards", description: "The school at a glance", icon: LayoutDashboard },
];

export const solutionLinks: readonly NavLink[] = [
  { href: "/solutions/school-leaders", label: "Principals & leaders", description: "One view of the whole school", icon: BarChart3 },
  { href: "/solutions/administrators", label: "School office", description: "Daily operations, done once", icon: LayoutDashboard },
  { href: "/solutions/teachers", label: "Teachers", description: "Only their assigned classrooms", icon: GraduationCap },
  { href: "/solutions/finance-teams", label: "Accounts teams", description: "Trace every rupee and balance", icon: CreditCard },
  { href: "/solutions/exam-teams", label: "Examination cells", description: "Marks to report cards", icon: BookOpen },
  { href: "/solutions/multi-campus", label: "Multi-campus groups", description: "Grow without blurring boundaries", icon: Building2 },
];

export const navMenus: readonly NavMenu[] = [
  { id: "product", label: "Product", links: productLinks },
  { id: "solutions", label: "Solutions", links: solutionLinks },
];

/** Plain top-level links shown after the dropdown menus. */
export const navPlainLinks: readonly NavLink[] = [
  { href: "/ai-ready", label: "AI-ready", description: "Permission-aware AI", icon: Bot },
  { href: "/security", label: "Security", description: "Roles, campuses, classrooms", icon: ShieldCheck },
];

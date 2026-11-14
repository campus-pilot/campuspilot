import {
  ChartColumn,
  ClipboardCheck,
  FilePenLine,
  FileText,
  GraduationCap,
  Megaphone,
  IndianRupee,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import type { FeatureSlug } from "@/site/content/catalog";
import type { FaqEntry } from "@/site/ui/faq";

/**
 * Page-local copy that enriches `featureData` (the product facts) for the
 * `/features/:slug` pages. Every line here restates something the catalog or
 * the product documentation already says; nothing introduces a new capability.
 * AI copy follows the site brief: today, a team's own assistant answers within
 * the asker's permissions; anything agentic is labelled as on the roadmap.
 */

export type FlowLink = {
  slug: FeatureSlug;
  /**
   * Which way the record travels: "into" when this feature feeds the linked one,
   * "from" when this feature reads from it (documents, dashboards, the portal).
   * Stated per link because the order of features does not imply it.
   */
  direction: "into" | "from";
  /** What the record carries into that feature, in one short sentence. */
  carries: string;
};

export type AiNote = {
  /** A question a staff member could put to the assistant they already use. */
  ask: string;
  /** How the answer is bounded (always: the asker's own permissions). */
  answer: string;
  /** Optional agentic idea; always rendered with an "On the roadmap" label. */
  roadmap?: string;
};

export type FeatureExtra = {
  /** Short name used in links, headings and the FAQ title ("Admissions"). */
  name: string;
  icon: LucideIcon;
  /** Accessible description of the hero artwork. */
  artLabel: string;
  /** One supporting line under each of the four catalog `steps`, same order. */
  stepNotes: readonly [string, string, string, string];
  /** The "done once" promise for this feature: what is entered once and where it is reused. */
  doneOnce: string;
  /** The two or three features this record feeds most directly. */
  next: readonly FlowLink[];
  /** Omitted where an assistant is not the relevant story (the student portal). */
  ai?: AiNote;
  faq: readonly FaqEntry[];
  ctaTitle: string;
};

export const featureExtras: Record<FeatureSlug, FeatureExtra> = {
  admissions: {
    name: "Admissions",
    icon: UserPlus,
    artLabel: "Admissions table: an enquiry moves through registration and class allocation into a student record.",
    stepNotes: [
      "Guardian contact, class interest and notes kept together.",
      "Registration status tracked against the same applicant.",
      "Class, section and the 2026–27 session assigned.",
      "The applicant becomes an active student record.",
    ],
    doneOnce:
      "Guardian details typed at the first enquiry are the same details on the fee account, the ID card and the report card. Nobody types them again.",
    next: [
      { slug: "academics", direction: "into", carries: "Class, section and session placement put the student on the right class list." },
      { slug: "billing", direction: "into", carries: "The student's fee account starts from the same record." },
      { slug: "documents", direction: "into", carries: "ID cards and other school documents print from that record." },
    ],
    ai: {
      ask: "How many Nursery applicants are still waiting on registration?",
      answer: "Answered from live admission records, and only for someone who is allowed to see admissions.",
    },
    faq: [
      {
        question: "Do we re-enter an applicant's details once they join?",
        answer:
          "No. A confirmed admission converts into an active student record once class, section and academic session are assigned, and the applicant and guardian details come with it.",
      },
      {
        question: "Is a student record tied to an academic session?",
        answer:
          "Yes. Student records are session-aware, so a placement such as Class 3 A in 2026–27 stays with that session while the student's record carries on.",
      },
      {
        question: "Who can see admission records?",
        answer:
          "Access follows the roles your school sets. Teachers work within the classes and sections assigned to them, and a family sees only their own child's information.",
      },
    ],
    ctaTitle: "See your admission desk in CampusPilot.",
  },
  academics: {
    name: "Academics",
    icon: GraduationCap,
    artLabel: "Academic setup: classes and sections for the session, with subject teachers assigned for Class 8 A.",
    stepNotes: [
      "2026–27 kept separate from earlier sessions.",
      "Nursery, LKG and UKG through Class 12, with subjects.",
      "Sections such as A, B and C within each class.",
      "Subject teachers and class teachers per section.",
    ],
    doneOnce:
      "The school structure is set up once per session. Class lists, exam plans, marks entry and teacher access all build on it instead of being configured again.",
    next: [
      { slug: "examinations", direction: "into", carries: "Exam plans and marks entry follow classes, subjects and teacher assignments." },
      { slug: "billing", direction: "into", carries: "Fee rules can be set per class within the session." },
      { slug: "dashboards", direction: "into", carries: "Class load and staffing snapshots read from the same structure." },
    ],
    ai: {
      ask: "Which subjects in Class 8 A have no teacher assigned yet?",
      answer: "Answered from the session's academic setup, within the permissions of the person asking.",
    },
    faq: [
      {
        question: "What happens to last session's classes when a new session starts?",
        answer:
          "Each academic session is kept distinct, along with the records and configuration that belong to it, so 2025–26 stays intact while you set up 2026–27.",
      },
      {
        question: "Can a teacher see classes they do not teach?",
        answer:
          "Teacher access follows assignments. Protected academic work can be limited to the classes and sections assigned to each teacher.",
      },
      {
        question: "Do pre-primary classes fit the same structure?",
        answer:
          "Yes. You configure your own classes, from Nursery, LKG and UKG through Class 12, each with its own sections and subjects.",
      },
    ],
    ctaTitle: "See your school structure in CampusPilot.",
  },
  billing: {
    name: "Finance and billing",
    icon: IndianRupee,
    artLabel: "Billing summary with ₹4,72,261 billed and ₹2,50,028 due, a fee receipt and a student ledger.",
    stepNotes: [
      "Fee rules by school, session, class or student.",
      "Monthly or individual bills in one billing run.",
      "Payments and discounts posted to the ledger.",
      "A printable receipt for every payment.",
    ],
    doneOnce:
      "A payment is recorded once. The receipt, the student ledger and the collection totals all update from that single entry.",
    next: [
      { slug: "documents", direction: "into", carries: "Bills and receipts print from posted billing records." },
      { slug: "dashboards", direction: "into", carries: "Billed, collected and outstanding totals move as payments are posted." },
      { slug: "student-portal", direction: "into", carries: "The student's own ledger can reach the family from the same source." },
    ],
    ai: {
      ask: "Which Class 8 families still owe Term 1 fees?",
      answer: "Answered from the ledger, and only for someone your school allows to see finance.",
      roadmap: "CampusPilot preparing the fee-reminder list for an accountant to review before anything goes out.",
    },
    faq: [
      {
        question: "Can different classes have different fees?",
        answer:
          "Yes. Fee rules can be set at school, session, class and student level, so a class-specific fee or a student-specific discount sits inside the same structure.",
      },
      {
        question: "Can we bill monthly, quarterly or yearly?",
        answer:
          "Yes. Billing can run monthly, quarterly or yearly, generated in bulk for the school or individually for one student.",
      },
      {
        question: "What if a payment was entered by mistake?",
        answer:
          "Payments are reversed rather than erased, so the ledger keeps a traceable history and a reversed payment can no longer produce a valid receipt.",
      },
      {
        question: "Who can see fee data?",
        answer:
          "Only the roles your school authorises for finance. Every finance action carries the active school and session with it.",
      },
    ],
    ctaTitle: "See your fee structure in CampusPilot.",
  },
  examinations: {
    name: "Examinations",
    icon: ClipboardCheck,
    artLabel: "Examination plans with their statuses and the marks entry for Class 8 A Science.",
    stepNotes: [
      "Plans per session, class and subject: written, practical or viva.",
      "A timetable per class; admit cards from the same plan.",
      "Marks and attendance entered by assigned teachers.",
      "Approved results become report cards.",
    ],
    doneOnce:
      "Marks are entered once, by the subject teacher. Approval, report cards and the student's own result view all use those same marks.",
    next: [
      { slug: "documents", direction: "into", carries: "Report cards and admit cards generate from approved records." },
      { slug: "student-portal", direction: "into", carries: "Approved results reach each student's own view." },
      { slug: "dashboards", direction: "into", carries: "Result progress by class stays visible to coordinators." },
    ],
    ai: {
      ask: "Which Class 8 subjects still have First Term marks pending?",
      answer: "Answered from live result progress, limited to what the person asking may see.",
      roadmap: "CampusPilot preparing report cards for a coordinator to check and approve.",
    },
    faq: [
      {
        question: "Can teachers enter marks only for their own subjects?",
        answer:
          "Yes. Teachers work inside their assigned classes and valid plans, while examination coordinators keep control of the workflow and review.",
      },
      {
        question: "Are co-scholastic grades included?",
        answer:
          "Yes. Co-scholastic grades sit alongside marks and attendance in the same lifecycle and go through the same approval.",
      },
      {
        question: "What if marks change after report cards are generated?",
        answer:
          "Generated documents show when their source data has changed, so the team regenerates the affected report cards instead of hunting for stale copies.",
      },
    ],
    ctaTitle: "See your exam season in CampusPilot.",
  },
  documents: {
    name: "Documents",
    icon: FileText,
    artLabel: "A report card for Riverview Public School generated from live records, with ID cards, admit cards and receipts.",
    stepNotes: [
      "Start from a built-in design in the template marketplace.",
      "Logo, layout and wording set once for the school.",
      "Preview with real records before anything is generated.",
      "Print-ready PDFs for one student or a whole class.",
    ],
    doneOnce:
      "Branding is set once and reused across sessions. Every report card, ID card and receipt after that comes from records already in CampusPilot.",
    next: [
      { slug: "student-portal", direction: "into", carries: "Students see the documents that belong to them." },
      { slug: "examinations", direction: "from", carries: "Changed marks flag affected report cards for regeneration." },
      { slug: "billing", direction: "from", carries: "Bills and receipts come straight from posted billing runs." },
    ],
    ai: {
      ask: "Adapt our report card template with the AI tool you already use.",
      answer:
        "CampusPilot prepares the instructions and print rules; you paste the result back, preview it and save it yourself. Nothing is sent anywhere on your behalf.",
    },
    faq: [
      {
        question: "Which documents can we generate?",
        answer:
          "Report cards, student ID cards, admit cards, timetables, bills and receipts. Account statements are generated per student from their ledger.",
      },
      {
        question: "Can we use our own report card format?",
        answer:
          "Yes. Start from a built-in template and adapt it to your school's branding and layout, or edit the template's HTML directly. The template is school-wide and reused across sessions until you change it.",
      },
      {
        question: "Do old documents change when we update a template?",
        answer:
          "No. Documents already generated stay downloadable as they were; the new template applies to the documents you generate next.",
      },
    ],
    ctaTitle: "See your school's documents in CampusPilot.",
  },
  dashboards: {
    name: "Dashboards",
    icon: ChartColumn,
    artLabel: "Role-based dashboards: the principal's view of collections, admissions and examination progress.",
    stepNotes: [
      "Admissions, billing and exams already feed it.",
      "Totals such as ₹2,02,878 collected stay current.",
      "Each role sees what belongs to it.",
      "Open the records behind any number.",
    ],
    doneOnce:
      "Nobody compiles a weekly report. Dashboards read from the work already entered in admissions, billing and examinations.",
    next: [
      { slug: "billing", direction: "from", carries: "Open the ledger behind the collection total." },
      { slug: "examinations", direction: "from", carries: "See which classes still have results pending." },
      { slug: "admissions", direction: "from", carries: "Go from the admissions count to the applicants behind it." },
    ],
    ai: {
      ask: "How much is outstanding this session, class by class?",
      answer: "The same numbers as the dashboard, given only to people allowed to see them.",
    },
    faq: [
      {
        question: "Does a teacher see the same dashboard as the principal?",
        answer:
          "No. Visibility follows roles, so leaders get a school-wide view while each team sees what falls within its responsibility.",
      },
      {
        question: "Do we still prepare reports in spreadsheets?",
        answer:
          "Dashboards reflect the work already happening in CampusPilot, so collections, admissions and exam progress are current without a parallel spreadsheet.",
      },
      {
        question: "Can a group of schools see each campus separately?",
        answer:
          "Yes. Each campus keeps its own records and permissions; a person who works across campuses switches context rather than seeing them merged.",
      },
    ],
    ctaTitle: "See your school's day at a glance.",
  },
  "question-papers": {
    name: "Question papers",
    icon: FilePenLine,
    artLabel: "A question paper on the school's letterhead, drafted by AI from photos of a handwritten paper, with ways to start and the PDF ready.",
    stepNotes: [
      "Photos of the handwritten paper, a description in chat, or an earlier paper.",
      "The AI writes the questions; the school's template adds the heading and footer.",
      "Ask for changes in chat; each change becomes a new version.",
      "Every version keeps its own PDF to preview and download.",
    ],
    doneOnce:
      "The school name, heading and footer are set once in your question paper template. Every paper prints with them, and the AI never writes them.",
    next: [
      { slug: "examinations", direction: "from", carries: "A paper belongs to one exam, class, subject and mode of the exam plan." },
      { slug: "documents", direction: "from", carries: "It prints through the same template system as report cards and notices." },
    ],
    ai: {
      ask: "Make a 40-mark Science paper for Class 8 from these photos.",
      answer: "The assistant writes the paper, and a teacher only reaches papers for classes they are assigned to.",
    },
    faq: [
      {
        question: "Does the AI decide what is on the paper?",
        answer: "The AI drafts the questions from your photos or description. A teacher reviews the paper, asks for changes in chat, and downloads it only when it is right. Nothing is final until a person saves it.",
      },
      {
        question: "Can it handle Hindi, Urdu and maths?",
        answer: "Yes. Hindi and other Indian languages, Urdu, which reads right to left, and mathematical expressions are all supported.",
      },
      {
        question: "What about diagrams?",
        answer: "Diagrams come from images you upload. Where the AI cannot reproduce one, it leaves a labelled placeholder, and you attach the real image in chat.",
      },
      {
        question: "Who can see a school's papers?",
        answer: "Access follows school roles. Teachers see and edit papers only for the classes assigned to them, while principals, managers and exam coordinators see every class.",
      },
      {
        question: "Is the AI feature on for every school?",
        answer: "It is enabled per school. Book a demo and we will show it with your own class and subject set-up.",
      },
    ],
    ctaTitle: "See a question paper made from your own handwriting.",
  },
  notices: {
    name: "Notices & notifications",
    icon: Megaphone,
    artLabel: "A school notice addressed to staff and Classes 6 to 8, delivered in the app, on WhatsApp and as a push notification.",
    stepNotes: [
      "A title and a body, written once as plain text or from a template.",
      "Staff, every class, or only the classes you select.",
      "A draft is reviewed and then published. Publishing is one way.",
      "Each channel's delivery is logged, with resend for failures.",
    ],
    doneOnce:
      "A notice is written once. The same notice reaches staff in the management app and students in their portal, and prints from the same record.",
    next: [
      { slug: "student-portal", direction: "into", carries: "Students read notices in their own portal." },
      { slug: "documents", direction: "from", carries: "Notices print through the school's notice template." },
      { slug: "examinations", direction: "from", carries: "Published results and timetables notify staff and students." },
    ],
    faq: [
      {
        question: "Where do notifications arrive?",
        answer: "In the app, on WhatsApp and as a push notification on a student's device. Bills, receipts, payments and published results use the same delivery.",
      },
      {
        question: "Can we send a notice to only some classes?",
        answer: "Yes. A notice can be addressed to staff, to every class, or to selected classes, and the audience is recorded when it is published.",
      },
      {
        question: "How do we know a message was delivered?",
        answer: "A delivery log shows each channel's outcome. A failed delivery can be resent, and failure alerts reach the school.",
      },
      {
        question: "Does WhatsApp reach everyone?",
        answer: "WhatsApp messages go to the number saved for the family, and only where the school has turned WhatsApp on. Where a message cannot be delivered, the log says so.",
      },
      {
        question: "Can a notice be printed?",
        answer: "Yes. Every notice can be printed on full or half A4 from the school's notice template.",
      },
    ],
    ctaTitle: "See notices reach staff and students.",
  },
  "student-portal": {
    name: "Student portal",
    icon: UsersRound,
    artLabel: "A family's phone view showing only Aarav's own records, with other students and staff records locked.",
    stepNotes: [
      "Students sign in separately from staff.",
      "The sign-in resolves to one student at one school.",
      "Results, timetable and ledger for that student only.",
      "Updates as the school's records change.",
    ],
    doneOnce:
      "Nothing is copied into the portal. Families see the same results, timetables and ledger the school already keeps, once they are approved.",
    next: [
      { slug: "examinations", direction: "from", carries: "Approved results appear in the student's own view." },
      { slug: "billing", direction: "from", carries: "The student's fee ledger, from the same source as the school's." },
      { slug: "documents", direction: "from", carries: "Their own documents, generated by the school." },
    ],
    faq: [
      {
        question: "Can a student see another student's results?",
        answer: "No. Portal requests are restricted to the signed-in student's own information.",
      },
      {
        question: "Does it work on a phone?",
        answer: "Yes. The portal is responsive and designed for phones as much as for tablets and desktops.",
      },
      {
        question: "Do students use the same sign-in as staff?",
        answer: "No. Student access is authenticated separately and kept apart from the staff workspace.",
      },
    ],
    ctaTitle: "See the student view with your school in mind.",
  },
};

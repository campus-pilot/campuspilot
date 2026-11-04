import type { SolutionSlug } from "@/site/content/catalog";
import type { NotebookProps } from "@/site/signature";

/**
 * Role-specific copy for `/solutions/:slug`, layered on top of the shared
 * `solutionData` facts (outcomes, steps, spotlight, bullets).
 *
 * Notebook rules (kept true to the product):
 * - chores are work this role repeats every day, term or session, each with
 *   how CampusPilot handles it now;
 * - chat 1 is answered inside the asker's access, chat 2 is politely refused
 *   because it is outside it (another campus, another class, another module);
 * - the roadmap note describes agentic AI *inside* CampusPilot that prepares
 *   work for a person to review. The notebook stamps it "Coming · on the
 *   roadmap", so the text never claims it is shipped.
 */
export type RoleContent = {
  /** Plural audience used in headings ("principals and school leaders"). */
  audience: string;
  /** Small line under the hero actions. */
  heroNote: string;
  notebook: {
    title: string;
    description: string;
    book: NotebookProps;
  };
  /** Feature pages this role opens most, in order (`featureDirectory` hrefs). */
  featureHrefs: readonly string[];
  cta: { title: string; description: string };
};

export const roleContent: Record<SolutionSlug, RoleContent> = {
  "school-leaders": {
    audience: "principals and school leaders",
    heroNote: "Illustrative view · Riverview Public School is fictional",
    notebook: {
      title: "The principal's checklist, crossed off.",
      description: "The questions a principal asks every week now answer themselves, and the assistant you already use replies with a principal's view, not more.",
      book: {
        leftKicker: "the principal's repeated work",
        leftTitle: "No more waiting for the Monday report.",
        chores: [
          { chore: "Wait for the office to count this week's admissions", how: "Admissions and registrations update on the session dashboard as the office works." },
          { chore: "Call the accounts desk to ask what is still outstanding", how: "Billed, collected and outstanding for the session, on one screen." },
          { chore: "Chase class teachers to find whose marks are pending", how: "Result entry progress by class, visible before the deadline." },
          { chore: "Sign report cards from paper copies, one class at a time", how: "Approve results once; report cards generate from the approved records." },
          { chore: "Re-check who teaches which section every new session", how: "Teacher assignments live with each class and section, session by session." },
        ],
        rightKicker: "ready for AI, today",
        rightTitle: "Ask about your school. Get a principal's answer.",
        chats: [
          {
            asker: "Principal · Riverview, whole school",
            question: "How many admissions are still waiting to be registered this session?",
            answer: "2 of 85 admissions for 2026–27 are not registered yet, both LKG enquiries. The other 83 are registered.",
            allowed: true,
          },
          {
            asker: "Principal · Riverview, whole school",
            question: "Compare our fee dues with the Jayanagar campus.",
            answer: "You don't have a role at Jayanagar, so its records stay out of reach. I can break Riverview's dues down by class instead.",
            allowed: false,
          },
        ],
        roadmap: {
          title: "Next page: the Monday brief, prepared for you",
          text: "Agentic AI inside CampusPilot that prepares a weekly note on admissions, collections and pending results for the principal to read and act on. It prepares; you decide.",
        },
      },
    },
    featureHrefs: ["/features/dashboards", "/features/admissions", "/features/billing", "/features/examinations"],
    cta: {
      title: "See your whole school on one screen.",
      description: "A focused walkthrough of the session dashboard, approvals and role access, with your classes, fee structures and exams in mind.",
    },
  },
  administrators: {
    audience: "school administrators",
    heroNote: "Illustrative view · students and school are fictional",
    notebook: {
      title: "The office register, crossed off.",
      description: "Every admission, session set-up and document run is entered once and flows on. The assistant answers office questions, inside the office's access.",
      book: {
        leftKicker: "the office's repeated work",
        leftTitle: "Entered once, not three times.",
        chores: [
          { chore: "Copy each admission form into the register, class list and fee file", how: "Enquiry → registration → class allocation → student record, entered once." },
          { chore: "Rebuild class and section lists when the session changes", how: "Set up 2026–27 classes, sections and subjects in a guided flow." },
          { chore: "Tell every new teacher which classes they may open", how: "Invite staff and assign classes; their access follows the assignment." },
          { chore: "Type ID cards and admit cards one student at a time", how: "Generate a whole class's ID cards or admit cards from live records." },
          { chore: "Re-type the same notice for every class", how: "Write the notice once, from one place." },
        ],
        rightKicker: "ready for AI, today",
        rightTitle: "Ask the office questions. Stay inside the office's access.",
        chats: [
          {
            asker: "Administrator · admissions and set-up",
            question: "Which registered admissions are still waiting for class allocation?",
            answer: "Two: Ira Kapoor for LKG and Vihaan Rao for Class 1. Guardian details are complete for both.",
            allowed: true,
          },
          {
            asker: "Administrator · admissions and set-up",
            question: "Waive the late fee for Aarav Sharma in Class 8 A.",
            answer: "Fee waivers aren't part of your role, so I can't touch his ledger. The accounts team can review it.",
            allowed: false,
          },
        ],
        roadmap: {
          title: "Next page: next session, drafted",
          text: "Agentic AI inside CampusPilot that drafts next session's classes, sections and teacher assignments from this year's, for an administrator to review before anything changes.",
        },
      },
    },
    featureHrefs: ["/features/admissions", "/features/academics", "/features/documents", "/security"],
    cta: {
      title: "Keep every student journey moving.",
      description: "Walk through admissions, session set-up, staff access and bulk documents with your own classes and sections in mind.",
    },
  },
  teachers: {
    audience: "teachers",
    heroNote: "Illustrative view · Ms. Kavita Rao is a fictional teacher",
    notebook: {
      title: "The teacher's register, crossed off.",
      description: "Attendance, marks and class lists stay with the classes a teacher is assigned, and so does the assistant: it answers for 3 B and 4 A, not the rest of the school.",
      book: {
        leftKicker: "the teacher's repeated work",
        leftTitle: "Less paperwork between lessons.",
        chores: [
          { chore: "Total the attendance register by hand at month end", how: "Mark attendance for your own class; the totals keep themselves." },
          { chore: "Write marks on paper slips and hand them to the exam cell", how: "Enter marks for your assigned subjects; the exam cell reviews them." },
          { chore: "Copy the class list from the office every new term", how: "Your classes and sections arrive with your assignment." },
          { chore: "Re-add every report card before signing it", how: "Totals and grades come from the marks entered; report cards follow approval." },
        ],
        rightKicker: "ready for AI, today",
        rightTitle: "Ask about your classes. Only your classes.",
        chats: [
          {
            asker: "Class teacher, 3 B · Maths, 4 A",
            question: "Who in 4 A doesn't have First Term maths marks yet?",
            answer: "4 of 32 are pending in 4 A: Arjun Mehta, Fatima Shaikh, Rohan Das and Tanvi Joshi.",
            allowed: true,
          },
          {
            asker: "Class teacher, 3 B · Maths, 4 A",
            question: "How did Class 5 A do in maths this term?",
            answer: "Class 5 A isn't one of your assigned classes, so its marks stay closed. I can compare 3 B and 4 A for you.",
            allowed: false,
          },
        ],
        roadmap: {
          title: "Next page: remarks, drafted for you",
          text: "Agentic AI inside CampusPilot that drafts report-card remarks from your classes' marks and attendance, for you to edit. Nothing is published until you and the exam cell approve it.",
        },
      },
    },
    featureHrefs: ["/features/academics", "/features/examinations", "/features/documents", "/security"],
    cta: {
      title: "Give teachers only the classes they teach.",
      description: "See assignment-based access, attendance and marks entry, and the hand-off to the exam cell in a short walkthrough.",
    },
  },
  "finance-teams": {
    audience: "finance teams",
    heroNote: "Illustrative figures in ₹ · fictional students",
    notebook: {
      title: "The accounts desk, crossed off.",
      description: "Every fee rule, payment and receipt is recorded once and lands in the right ledger. The assistant answers about money, never about marks.",
      book: {
        leftKicker: "the accountant's repeated work",
        leftTitle: "No more tallying the cash book twice.",
        chores: [
          { chore: "Recalculate each class's fees in a spreadsheet every quarter", how: "Fee rules for school, session, class and student; billing runs apply them." },
          { chore: "Write receipts by hand and copy them into the cash book", how: "Record a payment once; the receipt and the student's ledger update together." },
          { chore: "Keep a separate register of discounts and concessions", how: "Discounts sit on the student's ledger next to the bills they reduce." },
          { chore: "Add up bank slips and the cash box to know what is due", how: "Billed, collected and due for the session, already totalled." },
          { chore: "Prepare the defaulters list for the principal by hand", how: "Outstanding balances by class and student, straight from the ledgers." },
        ],
        rightKicker: "ready for AI, today",
        rightTitle: "Ask about fees. Get answers from the ledgers.",
        chats: [
          {
            asker: "Accountant · fees and ledgers",
            question: "What is still due from Class 8 A for 2026–27?",
            answer: "₹38,400 is due from 9 students in Class 8 A. The largest balance is ₹7,200, and two families paid this week.",
            allowed: true,
          },
          {
            asker: "Accountant · fees and ledgers",
            question: "Show me Class 8 A's half-yearly marks.",
            answer: "Marks and results aren't part of your access. I can show 8 A's ledgers and receipts instead.",
            allowed: false,
          },
        ],
        roadmap: {
          title: "Next page: the fee-reminder list, prepared",
          text: "Agentic AI inside CampusPilot that prepares the month's fee-reminder list from the ledgers, for the accounts team to check before anything goes to families.",
        },
      },
    },
    featureHrefs: ["/features/billing", "/features/dashboards", "/features/documents", "/features/student-portal"],
    cta: {
      title: "Trace every rupee, rule and receipt.",
      description: "Walk through fee rules, billing runs, payments, discounts and ledgers with your school's own fee structure in mind.",
    },
  },
  "exam-teams": {
    audience: "examination teams",
    heroNote: "Illustrative view · First Term at a fictional school",
    notebook: {
      title: "Exam season, crossed off.",
      description: "Plans, timetables, marks and approvals move through one lifecycle, so the exam cell coordinates instead of collecting. The assistant answers about exams, not fees.",
      book: {
        leftKicker: "the exam cell's repeated work",
        leftTitle: "One lifecycle instead of twenty trackers.",
        chores: [
          { chore: "Draw the exam timetable on chart paper and photocopy it per class", how: "Build the timetable once; publish it per class and print it as a document." },
          { chore: "Collect marks slips from every teacher and type them into one sheet", how: "Teachers enter marks for their own classes; progress shows class by class." },
          { chore: "Note which subjects are written, practical or viva", how: "Each subject plan carries its assessment mode." },
          { chore: "Fill admit cards by hand for every student", how: "Admit cards generate for every class from the exam plan." },
          { chore: "Re-check totals before report cards go home", how: "Approve results; report cards generate from the approved marks." },
        ],
        rightKicker: "ready for AI, today",
        rightTitle: "Ask about the exam. Get the exam cell's view.",
        chats: [
          {
            asker: "Exam coordinator · First Term",
            question: "Which classes are still entering First Term marks?",
            answer: "Two of eight: Class 4 A (28 of 32 maths marks in) and Class 5 A (19 of 30). The rest are completed or approved.",
            allowed: true,
          },
          {
            asker: "Exam coordinator · First Term",
            question: "Which families haven't paid this term's fees?",
            answer: "Fee records are outside the exam cell's access. I can help with plans, marks progress and admit cards.",
            allowed: false,
          },
        ],
        roadmap: {
          title: "Next page: report cards, queued for approval",
          text: "Agentic AI inside CampusPilot that checks results for gaps and queues report cards for the principal's approval, ready for a person to review.",
        },
      },
    },
    featureHrefs: ["/features/examinations", "/features/documents", "/features/academics", "/features/student-portal"],
    cta: {
      title: "Run exam season as one workflow.",
      description: "See plans, timetables, marks entry, approvals, admit cards and report cards with your own classes and subjects in mind.",
    },
  },
  "single-campus": {
    audience: "single-campus schools",
    heroNote: "Illustrative view · Riverview Public School is fictional",
    notebook: {
      title: "One school's busywork, crossed off.",
      description: "One record carries each student through admissions, fees, exams and documents. The assistants your staff already use answer within each person's own access.",
      book: {
        leftKicker: "the whole school's repeated work",
        leftTitle: "One record instead of four registers.",
        chores: [
          { chore: "Keep the admission register, fee file and exam sheet in step", how: "One student record carries through admissions, fees, exams and documents." },
          { chore: "Ask three people the same question to get one answer", how: "Every authorized team works from the same current records." },
          { chore: "Rebuild report-card and receipt formats every year", how: "Branded templates for report cards, receipts and ID cards, filled from live data." },
          { chore: "Start every session by copying last year's spreadsheets", how: "Set up the new session's classes and sections in a guided flow." },
        ],
        rightKicker: "ready for AI, today",
        rightTitle: "One school, many questions, each answered within access.",
        chats: [
          {
            asker: "Principal · whole school",
            question: "How many students do we have in each class this session?",
            answer: "83 students in 8 classes: Nursery 13, LKG 16, UKG 16, Class 1 16, and 22 across Classes 2 to 5.",
            allowed: true,
          },
          {
            asker: "Class teacher, 1 A · own class",
            question: "Give me every guardian's phone number in the school.",
            answer: "Contact details outside Class 1 A aren't in your access. I can list the guardians for your own class.",
            allowed: false,
          },
        ],
        roadmap: {
          title: "Next page: the new session, prepared",
          text: "Agentic AI inside CampusPilot that prepares next session's classes, fee rules and templates from this year's set-up, for your team to review and confirm.",
        },
      },
    },
    featureHrefs: ["/features/admissions", "/features/billing", "/features/examinations", "/features/documents"],
    cta: {
      title: "Bring the whole school into one operation.",
      description: "A focused walkthrough of admissions, fees, exams and documents for one campus, from set-up to the first report card.",
    },
  },
  "multi-campus": {
    audience: "multi-campus groups",
    heroNote: "Illustrative view · campuses and people are fictional",
    notebook: {
      title: "The group office's busywork, crossed off.",
      description: "One account reaches every campus a person belongs to, with a separate role at each. The assistant follows the campus you're working in, and the role you hold there.",
      book: {
        leftKicker: "the group's repeated work",
        leftTitle: "One account, campuses kept apart.",
        chores: [
          { chore: "Keep a separate login and spreadsheet for every campus", how: "One account; choose the campus you're working in." },
          { chore: "Give a teacher who works at two campuses two logins", how: "One account, with a separate role at each campus." },
          { chore: "Worry that one campus's office can see another's students", how: "Records and permissions stay local to each campus." },
          { chore: "Keep a different letterhead file for each campus", how: "Each campus has its own templates and branding." },
          { chore: "Rewrite fee rules for each campus in a shared sheet", how: "Each campus keeps its own sessions and fee rules." },
        ],
        rightKicker: "ready for AI, today",
        rightTitle: "Ask on one campus. Get that campus's answer.",
        chats: [
          {
            asker: "Principal · Whitefield campus",
            question: "How much is outstanding at Whitefield this session?",
            answer: "₹2,50,028 is due at Whitefield for 2026–27, and ₹2,02,878 has been collected.",
            allowed: true,
          },
          {
            asker: "Exam coordinator · Jayanagar campus",
            question: "Show me Jayanagar's fee dues.",
            answer: "At Jayanagar your role is exam coordinator, so fee records stay out of reach there. I can show Jayanagar's First Term progress.",
            allowed: false,
          },
        ],
        roadmap: {
          title: "Next page: a weekly note for every campus",
          text: "Agentic AI inside CampusPilot that prepares each campus's weekly summary from that campus's own records, for its leadership to review.",
        },
      },
    },
    featureHrefs: ["/features/dashboards", "/features/academics", "/features/documents", "/security"],
    cta: {
      title: "Grow campuses without blurring them.",
      description: "See campus switching, local roles and per-campus templates in a walkthrough shaped around your group's schools.",
    },
  },
};

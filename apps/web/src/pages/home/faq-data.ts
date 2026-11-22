import type { FaqEntry } from "@/site/ui/faq";

/** Home page FAQ. Every answer describes what the management app does today. */
export const homeFaqs: readonly FaqEntry[] = [
  {
    question: "Is CampusPilot built for schools in India?",
    answer:
      "Yes. It works the way Indian schools run: academic sessions such as 2026–27, Nursery, LKG and UKG through Class 12 with sections, fee structures in rupees with receipts and student ledgers, admit cards and report cards, and groups that run more than one school.",
  },
  {
    question: "What does “AI-ready” actually mean?",
    answer:
      "You can simply ask CampusPilot. Talk or type to the assistant built into the app, or connect the AI assistant your team already uses. Either way it answers from live records (collections, admissions, pending marks) through the same permissions as the person asking.",
  },
  {
    question: "Can an assistant see data a person isn’t allowed to see?",
    answer:
      "No. The assistant acts as the person using it. A class teacher’s assistant only sees that teacher’s assigned classes and sections, finance details stay with finance roles, and each school stays separate. Anything that would change a record waits on screen for that person’s approval.",
  },
  {
    question: "Is there AI inside CampusPilot itself?",
    answer:
      "Yes. CampusPilot has its own assistant, with a voice model you can talk to from any page and a reasoning model behind the chat in ⌘K and the Assistant page. It answers with tables, results and documents, makes changes such as recording a payment once you approve them, and drafts question papers from a photo of a handwritten paper or a description. Your school chooses which roles may use it.",
  },
  {
    question: "Who is CampusPilot for?",
    answer:
      "Principals and school leaders, office staff, teachers, accounts and examination teams, plus students, who get their own Cadet Portal. It suits a single school as well as a group running several.",
  },
  {
    question: "What does CampusPilot cover today?",
    answer:
      "Admissions from enquiry to student record, academics (sessions, classes, subjects, teacher assignments), fees and billing with receipts and ledgers, examinations with timetables, marks, approvals, report cards and admit cards, question papers, school documents, notices with WhatsApp delivery, dashboards, the Cadet Portal for students, and the built-in AI assistant.",
  },
  {
    question: "How do we get started?",
    answer:
      "Contact us. We’ll walk through CampusPilot with your own school in mind (your sessions, classes, fee structures and exams) and answer your questions about getting set up.",
  },
];

import type { FaqEntry } from "@/site/ui/faq";

/** AI-specific questions for `/ai-ready`. Plain business language: no protocol or technical terms. */
export const aiFaqEntries: readonly FaqEntry[] = [
  {
    question: "Which AI assistants can work with CampusPilot?",
    answer:
      "Compatible AI assistants your team already uses can be connected to your school's CampusPilot. In a demo we look at the assistants your staff rely on and show what they can do with your records.",
  },
  {
    question: "Can an assistant see more than the person using it?",
    answer:
      "No. The assistant acts as the person asking, so it follows their campus, role and class access. A class teacher's assistant sees her assigned classes; an accountant's sees fees and receipts; a parent's sees only their own child.",
  },
  {
    question: "Are our school records copied into the AI tool?",
    answer:
      "No separate copy is made. Each time someone asks, CampusPilot checks their access and answers from the live record, so the answer reflects today's marks, payments and attendance.",
  },
  {
    question: "What happens when a staff member leaves or changes role?",
    answer:
      "Their assistant's reach changes with them. When their CampusPilot access is removed, the assistant can no longer reach your school's records; when their role changes, it follows the new role.",
  },
  {
    question: "Will AI send messages or make decisions on its own?",
    answer:
      "CampusPilot is not built for unsupervised decisions. AI inside CampusPilot drafts question papers, and a teacher reviews and saves them. On our roadmap is more prepared work, such as a fee-reminder list or report cards, for a person to review. Nothing goes out until someone approves it.",
  },
  {
    question: "How does AI question paper generation work?",
    answer:
      "A teacher uploads photos of a handwritten paper, or describes the paper in chat. AI drafts the questions, the teacher asks for changes in chat, and each change is saved as a new version with its own PDF. The school's own template provides the heading and footer, and teachers reach only the classes assigned to them.",
  },
  {
    question: "Which AI does CampusPilot use for this?",
    answer:
      "Question paper drafting and the assistant inside CampusPilot use Google's Gemini models. The details of what is sent are in our privacy policy.",
  },
];

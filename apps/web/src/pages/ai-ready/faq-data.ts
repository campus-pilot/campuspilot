import type { FaqEntry } from "@/site/ui/faq";

/** AI-specific questions for `/ai-ready`. Plain business language: no protocol or technical terms. */
export const aiFaqEntries: readonly FaqEntry[] = [
  {
    question: "Can I talk to the assistant inside CampusPilot?",
    answer:
      "Yes. Start voice from the top bar of the management app and speak as you would to a colleague. It keeps listening as you move between pages, can read the screen in front of you, and answers out loud while the tables, results or documents appear on screen. It works with your permissions, like the chat does.",
  },
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
      "No separate copy is made. Each time someone asks, CampusPilot checks their access and answers from the live record, so the answer reflects today's marks, payments and admissions.",
  },
  {
    question: "What happens when a staff member leaves or changes role?",
    answer:
      "Their assistant's reach changes with them. When their CampusPilot access is removed, the assistant can no longer reach your school's records; when their role changes, it follows the new role.",
  },
  {
    question: "Will AI send messages or make decisions on its own?",
    answer:
      "No. The assistant inside CampusPilot can do the work you could do in the app, such as recording a payment, publishing a notice or drafting a question paper, but every change waits on screen until the person who asked approves it. Declining, or stopping the request, leaves your records as they were.",
  },
  {
    question: "How does AI question paper generation work?",
    answer:
      "A teacher uploads photos of a handwritten paper, or describes the paper in chat. AI drafts the questions, the teacher asks for changes in chat, and each change is saved as a new version with its own PDF. The school's own template provides the heading and footer, and teachers reach only the classes assigned to them.",
  },
  {
    question: "Which AI models does CampusPilot use?",
    answer:
      "The assistant inside CampusPilot uses a voice model for talking and reasoning models for the work behind it, from leading AI providers; question paper drafting uses them too. Which providers process your data, and what is sent, is set out in our privacy policy.",
  },
];

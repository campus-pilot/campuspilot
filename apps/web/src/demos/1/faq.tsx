import { ArrowRight, Plus } from "lucide-react";
import { Link } from "react-router";

type Faq = {
  answer: string;
  question: string;
};

const faqs: readonly Faq[] = [
  {
    question: "Is CampusPilot built for schools in India?",
    answer:
      "Yes. It works the way Indian schools run: academic sessions such as 2026–27, Nursery, LKG and UKG through Class 12 with sections, fee structures in rupees with receipts and student ledgers, admit cards and report cards, and school groups with more than one campus.",
  },
  {
    question: "What does “AI-ready” actually mean?",
    answer:
      "Your school’s records are connected and structured, so the AI assistants your team already uses can work with them safely. An assistant answers from live records — collections, admissions, pending marks — through the same permissions as the person asking.",
  },
  {
    question: "Can an assistant see data a person isn’t allowed to see?",
    answer:
      "No. The assistant acts with the identity of the person using it. A class teacher’s assistant only sees that teacher’s assigned classes and sections, finance details stay with finance roles, and each campus stays separate.",
  },
  {
    question: "Is there AI inside CampusPilot itself?",
    answer:
      "It is on our roadmap, not available yet. We are working on agentic assistants inside the CampusPilot web app that prepare work — drafting the fee-reminder list, preparing report cards for approval — for a person to review before anything is sent.",
  },
  {
    question: "Who is CampusPilot for?",
    answer:
      "Principals and school leaders, administrators, teachers, finance and examination teams — plus students and families, who get their own access. It suits single-campus schools as well as multi-campus groups.",
  },
  {
    question: "How are campuses kept apart in a school group?",
    answer:
      "Every record belongs to a campus, and access is granted by role, campus and classroom. Staff work only inside the campuses and classes they are assigned to, so one campus never sees another’s students, fees or results by accident.",
  },
  {
    question: "What does CampusPilot cover today?",
    answer:
      "Admissions from enquiry to student record, academics (sessions, classes, subjects, teacher assignments), fees and billing with receipts and ledgers, examinations with marks, approvals, report cards and admit cards, school documents and notices, dashboards, and student and family access.",
  },
  {
    question: "How do we get started?",
    answer:
      "Book a demo. We’ll walk through CampusPilot with your own school in mind — your sessions, classes, fee structures and exams — and answer your questions about getting set up.",
  },
];

/**
 * Native `<details>` keeps the accordion keyboard- and screen-reader-friendly
 * without state. The shared `name` makes it exclusive (one answer open at a time)
 * in browsers that support it; the height animation uses `::details-content`
 * where available and degrades to an instant toggle elsewhere.
 */
function FaqItem({ faq }: { faq: Faq }) {
  return (
    <details className="d1-faq-item" name="d1-faq">
      <summary>
        <span>{faq.question}</span>
        <span className="d1-faq-icon" aria-hidden="true">
          <Plus />
        </span>
      </summary>
      <p className="d1-faq-answer">{faq.answer}</p>
    </details>
  );
}

function FaqIntro() {
  return (
    <div className="d1-faq-intro">
      <span className="d1-pill">FAQ</span>
      <h2 id="d1-faq-title">Questions schools ask us</h2>
      <p>What CampusPilot does today, what AI-ready means for your data, and what is coming next.</p>
      <Link className="d1-text-link" to="/book-demo">
        Still curious? Book a demo <ArrowRight aria-hidden="true" />
      </Link>
    </div>
  );
}

export function FaqSection() {
  return (
    <section className="d1-section d1-faq" id="faq" aria-labelledby="d1-faq-title">
      <FaqIntro />
      <div className="d1-faq-list">
        {faqs.map((faq) => (
          <FaqItem key={faq.question} faq={faq} />
        ))}
      </div>
    </section>
  );
}

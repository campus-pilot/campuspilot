import type { QuestionPaperInput } from "./schema";

/**
 * Two complete, valid papers (design.md C5). They are the worked examples in
 * the learn guide, the fixtures of the renderer and marketplace previews, and
 * the seed of the demo school, so they must always pass `questionPaper`
 * (tested). Totals: 15 and 20.
 */

/** Hindi + math, Class 9 Mathematics, computed total 15. */
export const EXAMPLE_HINDI_MATH_PAPER: QuestionPaperInput = {
  schemaVersion: 1,
  meta: {
    language: "hi",
    script: "devanagari",
    direction: "ltr",
    timeAllowed: "1 घंटा",
    maxMarks: 15,
    classLabel: "कक्षा 9",
    subjectLabel: "गणित",
  },
  generalInstructions: [
    "सभी प्रश्न अनिवार्य हैं।",
    "प्रश्नों के अंक उनके सामने दिए गए हैं।",
  ],
  sections: [
    {
      heading: "खंड अ",
      instructions: ["प्रत्येक प्रश्न 1 अंक का है। सही विकल्प चुनिए।"],
      questions: [
        {
          number: "1",
          type: "mcq",
          marks: 1,
          text: ["समीकरण ", { t: "math", tex: "2x+3=11" }, " का हल है:"],
          options: [
            { label: "(क)", text: [{ t: "math", tex: "x=2" }] },
            { label: "(ख)", text: [{ t: "math", tex: "x=4" }] },
            { label: "(ग)", text: [{ t: "math", tex: "x=7" }] },
            { label: "(घ)", text: [{ t: "math", tex: "x=14" }] },
          ],
        },
        {
          number: "2",
          type: "mcq",
          marks: 1,
          text: [
            "भुजा ",
            { t: "math", tex: "6" },
            " सेमी वाले वर्ग का क्षेत्रफल (वर्ग सेमी में) है:",
          ],
          options: [
            { label: "(क)", text: "12" },
            { label: "(ख)", text: "24" },
            { label: "(ग)", text: "36" },
            { label: "(घ)", text: "72" },
          ],
        },
      ],
    },
    {
      heading: "खंड ब",
      questions: [
        {
          number: "3",
          type: "short_answer",
          marks: 2,
          text: [
            "हल कीजिए: ",
            { t: "math", tex: "\\frac{x}{3}+\\sqrt{16}=7" },
          ],
        },
        {
          number: "4",
          type: "numerical",
          marks: 3,
          text: [
            "आव्यूह ",
            {
              t: "math",
              tex: "A=\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}",
            },
            " के लिए:",
          ],
          parts: [
            {
              label: "(क)",
              marks: 1,
              text: ["आव्यूह ", { t: "math", tex: "A" }, " की कोटि लिखिए।"],
            },
            {
              label: "(ख)",
              marks: 2,
              text: [{ t: "math", tex: "|A|" }, " का मान ज्ञात कीजिए।"],
            },
          ],
        },
      ],
    },
    {
      heading: "खंड स",
      instructions: ["प्रत्येक प्रश्न 4 अंक का है।"],
      questions: [
        {
          number: "5",
          type: "long_answer",
          marks: 4,
          text: [
            "द्विघात समीकरण ",
            { t: "math", tex: "x^2-5x+6=0" },
            " को गुणनखंड विधि से हल कीजिए।",
          ],
          alternatives: [
            {
              marks: 4,
              text: [
                "सूत्र ",
                {
                  t: "math",
                  tex: "x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}",
                },
                " से समीकरण ",
                { t: "math", tex: "2x^2-7x+3=0" },
                " के मूल ज्ञात कीजिए।",
              ],
            },
          ],
        },
        {
          number: "6",
          type: "long_answer",
          marks: 4,
          text: "नीचे दी गई सारणी का माध्य ज्ञात कीजिए:",
          blocks: [
            {
              type: "table",
              header: true,
              rows: [
                ["अंक", "10", "20", "30"],
                ["विद्यार्थी", "5", "8", "7"],
              ],
            },
          ],
        },
      ],
    },
  ],
};

/** English, Class 8 Science, computed total 20 (placeholder figure, OR choice, table, sub-parts). */
export const EXAMPLE_ENGLISH_SCIENCE_PAPER: QuestionPaperInput = {
  schemaVersion: 1,
  meta: {
    language: "en",
    script: "latin",
    direction: "ltr",
    timeAllowed: "45 minutes",
    maxMarks: 20,
    classLabel: "Class 8",
    subjectLabel: "Science",
  },
  generalInstructions: [
    "All questions are compulsory.",
    "Draw neat, labelled diagrams wherever required.",
  ],
  sections: [
    {
      heading: "Section A: Multiple choice",
      instructions: ["Each question carries 1 mark."],
      questions: [
        {
          number: "1",
          type: "mcq",
          marks: 1,
          text: "Which gas is released during photosynthesis?",
          options: [
            { label: "a", text: "Carbon dioxide" },
            { label: "b", text: "Oxygen" },
            { label: "c", text: "Nitrogen" },
            { label: "d", text: "Hydrogen" },
          ],
        },
        {
          number: "2",
          type: "mcq",
          marks: 1,
          text: [
            "The chemical formula of water is ",
            { t: "math", tex: "\\mathrm{H_2O}" },
            ". It contains:",
          ],
          options: [
            { label: "a", text: "2 atoms of hydrogen" },
            { label: "b", text: "2 atoms of oxygen" },
            { label: "c", text: "1 atom of hydrogen" },
            { label: "d", text: "3 atoms of oxygen" },
          ],
        },
      ],
    },
    {
      heading: "Section B: Short answer",
      instructions: ["Each question carries 2 marks."],
      questions: [
        {
          number: "3",
          type: "fill_blank",
          marks: 2,
          text: "The process of conversion of water vapour into liquid water is called ________.",
        },
        {
          number: "4",
          type: "short_answer",
          marks: 2,
          text: "Complete the table of states of matter.",
          blocks: [
            {
              type: "table",
              header: true,
              rows: [
                ["Substance", "State at room temperature"],
                ["Iron", "Solid"],
                ["Mercury", "________"],
              ],
            },
          ],
        },
      ],
    },
    {
      heading: "Section C: Long answer",
      questions: [
        {
          number: "5",
          type: "long_answer",
          marks: 6,
          text: "Answer the following about the human digestive system.",
          parts: [
            {
              label: "(a)",
              marks: 2,
              text: "Name the organ where most digestion is completed.",
            },
            {
              label: "(b)",
              marks: 4,
              text: "Describe the role of the liver and the pancreas in digestion.",
            },
          ],
        },
        {
          number: "6",
          type: "long_answer",
          marks: 4,
          text: "State two differences between a plant cell and an animal cell.",
          alternatives: [
            {
              marks: 4,
              text: "Explain why mitochondria are called the powerhouse of the cell.",
            },
          ],
        },
        {
          number: "7",
          type: "diagram",
          marks: 4,
          text: "Draw a labelled diagram of the human heart.",
          blocks: [
            {
              type: "figure_placeholder",
              description:
                "Hand-drawn labelled diagram of the human heart showing four chambers, aorta and vena cava",
              widthPct: 60,
            },
          ],
        },
      ],
    },
  ],
};

export const QUESTION_PAPER_EXAMPLES = [
  EXAMPLE_HINDI_MATH_PAPER,
  EXAMPLE_ENGLISH_SCIENCE_PAPER,
] as const;

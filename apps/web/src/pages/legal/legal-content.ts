/**
 * Plain-data legal copy for `/privacy` and `/terms`. Facts about CampusPilot's
 * own set-up (where data lives, which providers are used) are stated here once
 * and must be changed here when the set-up changes. This is a draft for legal
 * review, not legal advice.
 */

export type LegalBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: readonly string[] };

export type LegalSection = {
  id: string;
  title: string;
  blocks: readonly LegalBlock[];
};

export type LegalDocument = {
  title: string;
  /** Shown as "Last updated" under the heading. */
  updated: string;
  intro: string;
  sections: readonly LegalSection[];
};

/** The business behind CampusPilot, as it appears in both documents. */
export const LEGAL_ENTITY = {
  name: "CampusPilot",
  address: "Rajopati, Dumra, Sitamarhi, Bihar 843302, India",
  /** Used for privacy requests, grievances and legal notices alike. */
  email: "sks@campuspilot.in",
} as const;

const p = (text: string): LegalBlock => ({ kind: "p", text });
const list = (...items: string[]): LegalBlock => ({ kind: "list", items });

export const privacyPolicy: LegalDocument = {
  title: "Privacy Policy",
  updated: "14 November 2026",
  intro:
    "CampusPilot is school management software. This policy explains what personal data we handle, why, where it lives, who else touches it, and the rights you have under Indian law, including the Digital Personal Data Protection Act, 2023 (the DPDP Act) and the Information Technology Act, 2000 with its rules.",
  sections: [
    {
      id: "who-we-are",
      title: "Who we are and our role",
      blocks: [
        p(`${LEGAL_ENTITY.name}, ${LEGAL_ENTITY.address}, provides the CampusPilot platform to schools.`),
        p("For the records a school keeps in CampusPilot, such as admissions, student details, fees, results, notices and question papers, the school decides why and how the data is used. In the language of the DPDP Act, the school is the Data Fiduciary and CampusPilot processes that data on the school's behalf as its Data Processor."),
        p("For people who visit our website, contact us, or book a demo, CampusPilot is the Data Fiduciary for the details they give us."),
      ],
    },
    {
      id: "data-we-handle",
      title: "The personal data we handle",
      blocks: [
        p("What a school stores depends on how it uses CampusPilot. It can include:"),
        list(
          "Student and guardian details: names, dates of birth, class and section, admission number, photographs, addresses, phone numbers and email addresses.",
          "Academic records: attendance, marks, grades, remarks, report cards, admit cards and question papers.",
          "Fee records: bills, payments, receipts, discounts and ledgers. We do not store card or bank-login details.",
          "Staff details: names, roles, contact details and the classes they are assigned to.",
          "Account and security data: sign-in identifiers, session records, device and browser details, IP addresses and push-notification subscriptions.",
          "Messages: notices, and records of notifications sent to people through the app, push notifications and WhatsApp, with their delivery status.",
          "Content you give the AI features: photographs of handwritten question papers, descriptions typed into the assistant and the papers the AI drafts.",
          "Website and enquiry data: the name, school, phone number and email you share when you contact us or book a demo.",
        ),
      ],
    },
    {
      id: "why-we-use-it",
      title: "Why we use it",
      blocks: [
        p("We use personal data only to provide CampusPilot to the school that uses it, and for the purposes below:"),
        list(
          "Running the school's workflows: admissions, academics, fees, examinations, documents and the student portal.",
          "Sending notices, receipts, results and alerts the school asks us to send.",
          "Drafting question papers and answering staff questions with AI, when the school has turned those features on.",
          "Keeping the service secure, preventing misuse, fixing faults and meeting legal obligations.",
          "Replying to enquiries and arranging demos.",
        ),
        p("We do not sell personal data. We do not show advertising in CampusPilot, and we do not use students' data to build advertising profiles."),
      ],
    },
    {
      id: "consent-and-children",
      title: "Consent and children's data",
      blocks: [
        p("Most students in CampusPilot are under 18. The DPDP Act requires verifiable consent of a parent or lawful guardian before a child's personal data is processed, and prohibits tracking or behavioural monitoring of children and advertising aimed at them."),
        p("The school collects the student's details from families and is responsible for obtaining that consent as the Data Fiduciary. CampusPilot processes children's data only for the school's educational and administrative purposes. We do not track or monitor children's behaviour, and we do not target advertising at them."),
        p("If you believe a child's data has been added without the right consent, write to the school first, or to us at the address below, and we will help the school resolve it."),
      ],
    },
    {
      id: "ai-features",
      title: "AI features",
      blocks: [
        p("Some features use Google's Gemini models: drafting question papers from photographs or descriptions, and the assistant inside CampusPilot. When someone uses them, the content they provide and the school records needed to answer are sent to Google for processing, and the result comes back to CampusPilot."),
        p("Gemini may process this data on servers outside India. These features can be turned off for a school. A person reviews AI output before it is saved or sent, and AI does not make decisions about students on its own."),
        p("AI assistants that a school connects to CampusPilot see only what the person using them is permitted to see."),
      ],
    },
    {
      id: "who-we-share-with",
      title: "Who else handles the data",
      blocks: [
        p("We use a small number of providers to run the service, and share data with them only as needed:"),
        list(
          "Google (Gemini): AI processing described above.",
          "Meta (WhatsApp Business Platform): to deliver notices, receipts and alerts by WhatsApp to the phone number the school has saved. The message content and the recipient's number are shared with Meta, which may process them outside India.",
          "Cloudflare: provides the secure tunnel that carries traffic between your browser and our servers, so traffic passes through Cloudflare's network.",
          "Authorities: where the law or a court order requires us to disclose data.",
        ),
        p("Within a school, access follows roles: teachers see their assigned classes, students and families see only their own records, and each school's data is kept separate from other schools."),
      ],
    },
    {
      id: "where-it-lives",
      title: "Where data is stored and how it is protected",
      blocks: [
        p("CampusPilot's databases and files are hosted on our own servers at a private data centre in India, not with a public cloud provider. Traffic is encrypted in transit."),
        p("We protect data with school-level separation, role-based permissions, separate student sign-in, access logging and restricted administrative access. No system is perfectly secure, and we cannot promise absolute security."),
        p("If a personal data breach affects you, we will tell the school and, as the law requires, the Data Protection Board of India and the affected people."),
      ],
    },
    {
      id: "retention",
      title: "How long we keep data",
      blocks: [
        p("We keep a school's data while its CampusPilot account is active. A school can ask us to export or delete its data when it stops using CampusPilot, and we delete it unless the law requires us to keep it. Enquiry and demo details are kept only as long as needed to respond and follow up."),
        p("Schools may have their own record-keeping duties, for example for transfer certificates and academic records, so a school may keep records even after a student leaves."),
      ],
    },
    {
      id: "cookies",
      title: "Cookies and similar technology",
      blocks: [
        p("CampusPilot uses cookies and similar storage only to keep you signed in and to keep the service working. We do not use advertising cookies. The student portal can ask permission to send push notifications to a device, and you can turn them off in your browser at any time."),
      ],
    },
    {
      id: "your-rights",
      title: "Your rights",
      blocks: [
        p("Under the DPDP Act you can:"),
        list(
          "Ask for a summary of the personal data held about you and who it is shared with.",
          "Ask for correction, completion or updating of your data.",
          "Ask for erasure of your data, where it is no longer needed.",
          "Withdraw consent you gave us, with the same ease as giving it.",
          "Ask for grievance redressal, and nominate another person to exercise these rights if you die or cannot do so yourself.",
        ),
        p("For school records, please ask the school first because it decides how the data is used. You can also write to us and we will pass the request to the school or deal with it ourselves where we are the Data Fiduciary. A parent or guardian can exercise these rights for a child."),
      ],
    },
    {
      id: "grievance",
      title: "Grievance officer and contact",
      blocks: [
        p(`Grievance Officer, ${LEGAL_ENTITY.name}, ${LEGAL_ENTITY.address}.`),
        p(`Email: ${LEGAL_ENTITY.email}`),
        p("We acknowledge complaints promptly and aim to resolve them within 30 days. If you are not satisfied, you may complain to the Data Protection Board of India once it is in operation."),
      ],
    },
    {
      id: "changes",
      title: "Changes to this policy",
      blocks: [
        p("We may update this policy as CampusPilot or the law changes. The date at the top shows when it last changed. For significant changes we will tell schools using the service."),
      ],
    },
  ],
};

export const termsOfUse: LegalDocument = {
  title: "Terms of Use",
  updated: "14 November 2026",
  intro:
    "These terms apply when a school, its staff, or its students and families use CampusPilot. By using CampusPilot you agree to them. If you use it for a school, you confirm you are allowed to act for that school.",
  sections: [
    {
      id: "the-service",
      title: "The service",
      blocks: [
        p("CampusPilot is school management software covering admissions, academics, fees, examinations, documents, notices, notifications, question papers and a student portal. Features are enabled per school, and we may add, change or remove features over time."),
      ],
    },
    {
      id: "accounts",
      title: "Accounts and access",
      blocks: [
        p("Each school decides who gets an account and what role they hold. Keep your sign-in details to yourself and tell your school or us if you think someone else has used them. You are responsible for activity under your account."),
        p("Students and families sign in through the student portal and can see only their own records."),
      ],
    },
    {
      id: "school-responsibilities",
      title: "A school's responsibilities",
      blocks: [
        p("A school is responsible for the data it puts into CampusPilot. It must have the right to use that data, including the consent of parents or guardians for children's data, and must use CampusPilot lawfully. Our Privacy Policy explains how we process data on the school's behalf."),
      ],
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      blocks: [
        p("You must not:"),
        list(
          "Try to access another school's data, or records you are not permitted to see.",
          "Probe, overload or disrupt the service, or try to get around its security.",
          "Upload unlawful, harmful or infringing content, or malicious code.",
          "Use CampusPilot to send spam or messages unrelated to the school's work.",
          "Resell or share access to CampusPilot without our agreement.",
        ),
      ],
    },
    {
      id: "ai-output",
      title: "AI-generated content",
      blocks: [
        p("AI features, such as question paper drafting and the assistant, can make mistakes. A person must review AI output before relying on it, saving it, printing it or sending it. The school is responsible for the final content of papers, notices and other documents it publishes."),
      ],
    },
    {
      id: "messages",
      title: "Notices, WhatsApp and push messages",
      blocks: [
        p("Messages sent through CampusPilot are written and approved by the school. We deliver them using providers such as Meta's WhatsApp Business Platform and web push, and we cannot guarantee that a message will be delivered or read. Delivery status is shown in the delivery log."),
      ],
    },
    {
      id: "ownership",
      title: "Ownership",
      blocks: [
        p("The school keeps ownership of its data, and we do not claim it. CampusPilot, its software, design and brand belong to us. We give schools a limited, non-transferable right to use CampusPilot while their agreement with us continues."),
      ],
    },
    {
      id: "availability",
      title: "Availability and changes",
      blocks: [
        p("We work to keep CampusPilot available but do not promise it will always be uninterrupted or free of errors. We may carry out maintenance, and we may suspend access to protect the service or comply with the law."),
      ],
    },
    {
      id: "liability",
      title: "Liability",
      blocks: [
        p("To the extent the law allows, CampusPilot is provided as it is, and we are not liable for indirect or consequential loss, or for loss caused by events beyond our reasonable control. Our total liability for any claim is limited to the fees the school paid us for the service in the three months before the claim arose. Nothing in these terms limits liability that the law does not allow us to limit."),
      ],
    },
    {
      id: "ending",
      title: "Ending use",
      blocks: [
        p("A school can stop using CampusPilot at any time. We may suspend or end access for serious or repeated breaches of these terms. On ending, we handle the school's data as described in the Privacy Policy."),
      ],
    },
    {
      id: "law",
      title: "Governing law",
      blocks: [
        p("These terms are governed by the laws of India. Courts at Sitamarhi, Bihar have jurisdiction over disputes, subject to any right that cannot be excluded by law."),
      ],
    },
    {
      id: "contact",
      title: "Contact",
      blocks: [
        p(`${LEGAL_ENTITY.name}, ${LEGAL_ENTITY.address}. Email: ${LEGAL_ENTITY.email}`),
      ],
    },
  ],
};

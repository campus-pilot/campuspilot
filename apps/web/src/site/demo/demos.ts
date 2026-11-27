import { env } from "@campuspilot/env/web";
import { Bot, ClipboardCheck, FilePenLine, FileText, IndianRupee, Megaphone, UsersRound, type LucideIcon } from "lucide-react";

import type { FeatureSlug } from "@/site/content/catalog";

/** Narration languages every demo is recorded in. English is the default. */
export type DemoLanguage = "en" | "hi";

export type DemoLanguageOption = {
  id: DemoLanguage;
  /** Shown on the button, in the language itself. */
  label: string;
  /** English name for assistive technology ("Play in Hindi"). */
  name: string;
};

export const demoLanguages: readonly DemoLanguageOption[] = [
  { id: "en", label: "English", name: "English" },
  { id: "hi", label: "हिंदी", name: "Hindi" },
];

export type Demo = {
  /** File stem: `<id>.<language>.mp4` under `VITE_DEMO_MEDIA_URL`, and the `<id>.webp` cover in `public/demos/`. */
  id: string;
  title: string;
  summary: string;
  /**
   * The feature page whose hero plays this demo. `null` when the demo has no
   * feature page of its own (the AI assistant lives on `/ai-ready`).
   */
  featureSlug: FeatureSlug | null;
  icon: LucideIcon;
  /** The page that explains this feature, linked under the home player. */
  href: string;
  hrefLabel: string;
  /** Length of each narrated cut in seconds; the cuts differ because the narration does. */
  durations: Record<DemoLanguage, number>;
};

/**
 * Narrated screen recordings of the real app on the demo school, one per
 * feature, produced in `.sks/marketing-video/feature-wise-demo/` (the Hindi
 * cut is the folder's `hinglish` render). Order is the home section's order.
 */
export const demos: readonly Demo[] = [
  {
    id: "question-paper",
    title: "Question papers with AI",
    summary: "Photos of a handwritten Hindi paper become a printed paper, then a maths paper is written from a typed description.",
    featureSlug: "question-papers",
    icon: FilePenLine,
    href: "/features/question-papers",
    hrefLabel: "Explore question papers",
    durations: { en: 182, hi: 190 },
  },
  {
    id: "billing-and-payment",
    title: "Bills and payments",
    summary: "Post a bill for one student, record a cash payment, then check the ledger and the receipt.",
    featureSlug: "billing",
    icon: IndianRupee,
    href: "/features/billing",
    hrefLabel: "Explore finance and fees",
    durations: { en: 95, hi: 99 },
  },
  {
    id: "exam-to-cadet-marks",
    title: "Exam to published result",
    summary: "Plan an exam and its timetable, enter marks, release results, and see them in the student's portal.",
    featureSlug: "examinations",
    icon: ClipboardCheck,
    href: "/features/examinations",
    hrefLabel: "Explore examinations",
    durations: { en: 120, hi: 122 },
  },
  {
    id: "document-generation",
    title: "Documents from records",
    summary: "Create a student ID card and a report card from the school's templates, then find both in history.",
    featureSlug: "documents",
    icon: FileText,
    href: "/features/documents",
    hrefLabel: "Explore documents",
    durations: { en: 88, hi: 91 },
  },
  {
    id: "notice-and-whatsapp",
    title: "Notices and WhatsApp",
    summary: "Write a notice for selected classes, publish it, read the delivery log, then see it on a student's phone and a WhatsApp sample.",
    featureSlug: "notices",
    icon: Megaphone,
    href: "/features/notices",
    hrefLabel: "Explore notices",
    durations: { en: 109, hi: 115 },
  },
  {
    id: "cadet-portal-tour",
    title: "Student portal tour",
    summary: "A student's phone: home, notices, fees and ledger, results, growth and the exam timetable.",
    featureSlug: "student-portal",
    icon: UsersRound,
    href: "/features/student-portal",
    hrefLabel: "Explore the student portal",
    durations: { en: 89, hi: 93 },
  },
  {
    id: "ai-assistant",
    title: "AI assistant",
    summary: "Ask who has fees due, then record a payment through the assistant, approved before anything is saved.",
    featureSlug: null,
    icon: Bot,
    href: "/ai-ready",
    hrefLabel: "Explore AI-ready",
    durations: { en: 71, hi: 75 },
  },
];

export function demoForFeature(slug: FeatureSlug): Demo | undefined {
  return demos.find((demo) => demo.featureSlug === slug);
}

/**
 * The videos are served from the R2 bucket (`VITE_DEMO_MEDIA_URL`), not the web
 * image, so playback traffic never reaches the cluster. Covers stay in `public/demos/`.
 */
export function demoVideoSrc(demo: Demo, language: DemoLanguage) {
  return `${env.VITE_DEMO_MEDIA_URL}/${demo.id}.${language}.mp4`;
}

export function demoPosterSrc(demo: Demo) {
  return `/demos/${demo.id}.webp`;
}

/** `95` → `"1:35"`. */
export function formatDuration(seconds: number) {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

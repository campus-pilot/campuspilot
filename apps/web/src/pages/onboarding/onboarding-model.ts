import {
  DEFAULT_CLASS_NAMES,
  LOGO_MIME_TYPES,
  MAX_CLASSES,
  MAX_LOGO_BYTES,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_SECTIONS_PER_CLASS,
  MAX_SUBJECTS_PER_CLASS,
  MAX_VOICE_NOTE_BYTES,
  type SchoolOnboardingSubmission,
} from "@campuspilot/api/leads/school-onboarding";
import { phoneInputValueFromStored, phoneInputValueToE164, requiredPhoneInputSchema, type PhoneInputValue } from "@campuspilot/components/phone-input";
import { z } from "zod";

import type { RecordedVoiceNote } from "./voice-recorder";

/**
 * The form's steps, in order. The page shows "Step n of 5" and the step
 * titles, so a school always knows how much is left.
 */
export const STEPS = [
  { id: "school", label: "School", title: "Your school", description: "The name, logo and address we will set your school up with." },
  { id: "contact", label: "Contact", title: "How to reach you", description: "We will contact you on this number about the setup." },
  { id: "classes", label: "Classes", title: "Classes and sections", description: "Pick the classes your school runs, then the sections of each class." },
  { id: "subjects", label: "Subjects", title: "Subjects", description: "Pick the subjects taught in each class. Add any that are missing." },
  { id: "notes", label: "Anything else", title: "Anything else?", description: "Type or record anything else we should know. This step is optional." },
] as const;
export type StepId = (typeof STEPS)[number]["id"];
/** Where the form is: one of the steps, or the thank-you note once the request is saved. */
export type Step = StepId | "sent";

export function stepIndex(step: StepId) {
  return STEPS.findIndex((candidate) => candidate.id === step);
}

/** A class as the form edits it; becomes `OnboardingClass` on submit. */
export type ClassDraft = { name: string; sections: string[]; subjects: string[] };

/** A picked logo with an object URL for its preview; revoke the URL when replaced or removed. */
export type PickedLogo = { file: File; previewUrl: string };

/** Why a logo cannot be sent, or null when it can. Checked when picked and again on Continue. */
export function logoProblem(logo: PickedLogo | null): string | null {
  if (!logo) return null;
  if (!(LOGO_MIME_TYPES as readonly string[]).includes(logo.file.type)) return "Choose a JPEG, PNG or WebP image.";
  if (logo.file.size > MAX_LOGO_BYTES) return `Choose an image of ${MAX_LOGO_BYTES / 1024 / 1024} MB or less.`;
  return null;
}

/** Names compared as people read them: "Class 1" and "class 1" are the same. */
export function sameName(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/** Classes kept in school order: the ready-made ones first in their order, then added ones as added. */
export function orderClasses(classes: ClassDraft[]) {
  const rank = (name: string) => {
    const index = DEFAULT_CLASS_NAMES.findIndex((candidate) => sameName(candidate, name));
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return [...classes].sort((left, right) => rank(left.name) - rank(right.name));
}

/**
 * The form's checks. Each step checks only its own questions, so "Continue"
 * moves on once the step in view is complete; the API checks every answer
 * again with `schoolOnboardingResponseSchema`.
 */
export const onboardingFormSchema = z
  .object({
    step: z.enum(["school", "contact", "classes", "subjects", "notes", "sent"]),
    submissionId: z.string(),
    schoolName: z.string(),
    logo: z.custom<PickedLogo | null>(),
    address: z.string(),
    phone: z.custom<PhoneInputValue>(),
    email: z.string(),
    classes: z.custom<ClassDraft[]>(),
    notes: z.string(),
    voiceNote: z.custom<RecordedVoiceNote | null>(),
  })
  .superRefine((value, context) => {
    const issue = (path: string, message: string) => context.addIssue({ code: "custom", path: [path], message });
    if (value.step === "school") {
      const name = value.schoolName.trim();
      if (name.length < 2) issue("schoolName", "Enter the school name.");
      else if (name.length > 160) issue("schoolName", "Use at most 160 characters.");
      const problem = logoProblem(value.logo);
      if (problem) issue("logo", problem);
      const address = value.address.trim();
      if (address.length < 5) issue("address", "Enter the school address.");
      else if (address.length > 1000) issue("address", "Use at most 1,000 characters.");
    }
    if (value.step === "contact") {
      const phone = requiredPhoneInputSchema("Enter a phone number.").safeParse(value.phone);
      if (!phone.success) issue("phone", phone.error.issues[0]?.message ?? "Enter a valid phone number.");
      const email = value.email.trim();
      if (email && !z.email().safeParse(email).success) issue("email", "Enter a valid email address, or leave it empty.");
    }
    if (value.step === "classes") {
      if (value.classes.length === 0) issue("classes", "Choose at least one class.");
      else if (value.classes.length > MAX_CLASSES) issue("classes", `Choose at most ${MAX_CLASSES} classes.`);
      const missing = value.classes.filter((schoolClass) => schoolClass.sections.length === 0).map((schoolClass) => schoolClass.name);
      if (missing.length > 0) issue("classes", `Choose the sections of ${missing.join(", ")}.`);
      if (value.classes.some((schoolClass) => schoolClass.sections.length > MAX_SECTIONS_PER_CLASS)) {
        issue("classes", `A class can have at most ${MAX_SECTIONS_PER_CLASS} sections.`);
      }
    }
    if (value.step === "subjects") {
      const missing = value.classes.filter((schoolClass) => schoolClass.subjects.length === 0).map((schoolClass) => schoolClass.name);
      if (missing.length > 0) issue("classes", `Choose the subjects of ${missing.join(", ")}.`);
      if (value.classes.some((schoolClass) => schoolClass.subjects.length > MAX_SUBJECTS_PER_CLASS)) {
        issue("classes", `A class can have at most ${MAX_SUBJECTS_PER_CLASS} subjects.`);
      }
    }
    if (value.step === "notes") {
      if (value.notes.trim().length > MAX_NOTES_LENGTH) issue("notes", `Use at most ${MAX_NOTES_LENGTH.toLocaleString("en-IN")} characters.`);
      if (value.voiceNote && value.voiceNote.blob.size > MAX_VOICE_NOTE_BYTES) issue("voiceNote", "This recording is too large. Record a shorter one.");
    }
  });

export type OnboardingFormValues = z.input<typeof onboardingFormSchema>;

/** A typed section, subject or class name: trimmed, inner spaces collapsed, within the length limit. */
export const customNameSchema = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1, "Type a name first.").max(MAX_NAME_LENGTH, `Use at most ${MAX_NAME_LENGTH} characters.`));

export function defaultOnboardingValues(): OnboardingFormValues {
  return {
    step: "school",
    // Drawn on the first send of this fill; every retry reuses it.
    submissionId: "",
    schoolName: "",
    logo: null,
    address: "",
    phone: phoneInputValueFromStored(null),
    email: "",
    classes: [],
    notes: "",
    voiceNote: null,
  };
}

/** The API's `submission` field for validated form values. */
export function toSubmission(value: OnboardingFormValues, submissionId: string): SchoolOnboardingSubmission {
  return {
    submissionId,
    sourcePath: typeof window === "undefined" ? null : window.location.pathname,
    response: {
      schoolName: value.schoolName.trim(),
      phone: phoneInputValueToE164(value.phone) ?? "",
      email: value.email.trim() || null,
      address: value.address.trim(),
      classes: value.classes.map(({ name, sections, subjects }) => ({ name, sections, subjects })),
      notes: value.notes.trim() || null,
      voiceNoteSeconds: value.voiceNote?.seconds ?? null,
    },
  };
}

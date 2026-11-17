import type { SchoolFeatureKey } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';

/**
 * What a school loses when a feature goes off, shown before the change is
 * saved: on the feature's card, on its own settings page, and in the tier
 * card when a move to another tier takes the feature away. Exhaustive, so
 * every new feature states its consequence. Keep each one complete (staff,
 * students, notifications).
 */
export const DISABLE_WARNINGS: Record<SchoolFeatureKey, string> = {
  studentManagement:
    'Staff of this school can no longer open admissions, students, fees and billing, examination results, timetables and attendance, or student documents, and the AI assistant and connected AI apps lose their tools for them. The Cadet Portal, Notices and WhatsApp notifications switch off with it. No new bill, payment, result or timetable notification goes out. Classes, sections, subjects, staff, examinations and question papers keep working. All records are kept and come back when it is enabled again.',
  cadet:
    'Students of this school can no longer sign in or use the Cadet Portal, including connected AI apps. Staff can no longer issue portal passwords, release exam results to the portal, or save or publish a notice addressed to students. Logins, released results and notices are kept.',
  notices:
    'Staff of this school can no longer open, write or publish notices, or edit the Notice template. Students no longer see notices in the Cadet Portal, and notice notifications that have not gone out yet are not sent. Existing notices are kept.',
  whatsapp:
    'Guardians of this school no longer receive WhatsApp messages. Copies that have not been sent yet are skipped, and a failed WhatsApp message can no longer be resent. The inbox and web push notifications are not affected. WhatsApp numbers, verification and consent are kept and apply again when it is enabled.',
  assistant:
    'Staff of this school no longer see the AI assistant or their assistant conversations. A turn in progress is refused at its next model request; a turn waiting for approval stays paused until the assistant is enabled again. Conversations, usage and costs are kept and come back when the assistant is enabled again.',
};

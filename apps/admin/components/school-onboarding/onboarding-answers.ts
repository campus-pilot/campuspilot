import type { SchoolRegistrationRequestDto } from '@campuspilot/api/routers/system-admin/school-registration-request/school-registration-request.dto';

/** A class as stored in the answers (see `leads/school-onboarding.ts`). */
export type OnboardingClassAnswer = { name: string; sections: string[]; subjects: string[] };

/**
 * Reading stored answers defensively, key by key: the JSON outlives any one
 * revision of the form, so a missing or retyped answer reads as missing
 * instead of breaking the page.
 */
export function textAnswer(request: SchoolRegistrationRequestDto, key: string) {
  const value = request.response[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function names(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function classAnswers(request: SchoolRegistrationRequestDto): OnboardingClassAnswer[] {
  const value = request.response.classes;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    return typeof record.name === 'string' ? [{ name: record.name, sections: names(record.sections), subjects: names(record.subjects) }] : [];
  });
}

export function voiceNoteSeconds(request: SchoolRegistrationRequestDto) {
  const value = request.response.voiceNoteSeconds;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatDuration(totalSeconds: number) {
  return `${Math.floor(totalSeconds / 60)}:${String(Math.round(totalSeconds % 60)).padStart(2, '0')}`;
}

export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

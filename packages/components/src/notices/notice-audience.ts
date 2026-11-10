/**
 * How a notice's audience is offered to its author and described to
 * readers. A notice stores two explicit facts (`toStaff` and `cadetScope`);
 * the author picks one of three readable choices and, when students are
 * included, which classes. This module converts between the two without
 * either side inferring a fact that was not chosen. API-free: the literal
 * types mirror the notice DTO structurally.
 */

/** Which students a notice addresses (the stored fact). */
export type NoticeCadetScope = 'none' | 'all_classes' | 'selected_classes';

/** The stored audience of a notice. */
export type NoticeAudienceFacts = { toStaff: boolean; cadetScope: NoticeCadetScope; classIds: readonly string[] };

/** The three choices an author reads. */
export const NOTICE_AUDIENCE_CHOICES = ['staff', 'cadets', 'staff_and_cadets'] as const;
export type NoticeAudienceChoice = (typeof NOTICE_AUDIENCE_CHOICES)[number];

/** Which classes, once students are included. */
export const NOTICE_CADET_CLASS_SCOPES = ['all_classes', 'selected_classes'] as const;
export type NoticeCadetClassScope = (typeof NOTICE_CADET_CLASS_SCOPES)[number];

export const NOTICE_AUDIENCE_OPTIONS: Record<NoticeAudienceChoice, { label: string; description: string }> = {
  staff: { label: 'Staff', description: 'Every staff member of the school, in this app.' },
  // Channel-neutral on purpose: which channels reach students depends on the
  // school and platform, and the publish confirmation states it from the forecast.
  cadets: { label: 'Cadets', description: 'Students, in the Cadet Portal and by their notifications.' },
  staff_and_cadets: { label: 'Staff and cadets', description: 'Everyone: staff here, students in the Cadet Portal and by their notifications.' },
};

export const NOTICE_CADET_CLASS_SCOPE_OPTIONS: Record<NoticeCadetClassScope, { label: string; description: string }> = {
  all_classes: { label: 'All classes', description: 'Every student enrolled in this session.' },
  selected_classes: { label: 'Selected classes', description: 'Only students of the classes you choose.' },
};

/**
 * The author's selection as the editor holds it. `cadetClassScope` and
 * `classIds` are kept while the audience is "Staff", so switching the
 * audience back and forth never discards a class selection; they are only
 * sent when students are included ({@link noticeAudienceFacts}).
 */
export type NoticeAudienceSelection = {
  audience: NoticeAudienceChoice;
  cadetClassScope: NoticeCadetClassScope;
  classIds: readonly string[];
};

export function noticeAudienceIncludesCadets(audience: NoticeAudienceChoice) {
  return audience !== 'staff';
}

/** The explicit facts a selection stores. Classes are sent only for "Selected classes". */
export function noticeAudienceFacts(selection: NoticeAudienceSelection): { toStaff: boolean; cadetScope: NoticeCadetScope; classIds: string[] } {
  const cadets = noticeAudienceIncludesCadets(selection.audience);
  const cadetScope: NoticeCadetScope = cadets ? selection.cadetClassScope : 'none';
  return {
    toStaff: selection.audience !== 'cadets',
    cadetScope,
    classIds: cadetScope === 'selected_classes' ? [...selection.classIds] : [],
  };
}

/**
 * The choice that reads back a stored audience. An audience addressed to
 * nobody cannot be stored; it reads as "Staff" so the editor always shows a
 * valid choice.
 */
export function noticeAudienceSelection(facts: NoticeAudienceFacts): NoticeAudienceSelection {
  const cadets = facts.cadetScope !== 'none';
  return {
    audience: cadets ? (facts.toStaff ? 'staff_and_cadets' : 'cadets') : 'staff',
    cadetClassScope: facts.cadetScope === 'selected_classes' ? 'selected_classes' : 'all_classes',
    classIds: [...facts.classIds],
  };
}

/**
 * The audience choices an author may pick from. With the Cadet Portal every
 * choice is offered. Without it (switched off, or not known because the
 * school's features could not be read) only "Staff" is, **plus the choice
 * the notice already has stored**: a draft addressed to students keeps
 * showing that it is, instead of silently reading "Staff". Whether such an
 * audience can be saved is the form's decision, not this list's.
 */
export function noticeAudienceChoicesOffered(cadetsAvailable: boolean, stored: NoticeAudienceChoice | null): NoticeAudienceChoice[] {
  if (cadetsAvailable) return [...NOTICE_AUDIENCE_CHOICES];
  return stored && stored !== 'staff' ? ['staff', stored] : ['staff'];
}

function classCount(count: number) {
  return `${count} ${count === 1 ? 'class' : 'classes'}`;
}

/**
 * One line naming the audience, for lists and summaries: "Staff",
 * "Cadets · All classes", "Staff and cadets · Class 6, Class 7".
 * `classNames` are the names of a selected-classes audience as the notice
 * records them (a published notice keeps the names it was published with,
 * also for classes deleted since). Up to three are listed; more, or none
 * known, reads as a count.
 */
export function noticeAudienceLabel(facts: Pick<NoticeAudienceFacts, 'toStaff' | 'cadetScope'>, classNames: readonly string[] = []) {
  const { audience } = noticeAudienceSelection({ ...facts, classIds: [] });
  const base = NOTICE_AUDIENCE_OPTIONS[audience].label;
  if (facts.cadetScope === 'none') return base;
  if (facts.cadetScope === 'all_classes') return `${base} · All classes`;
  return `${base} · ${classNames.length > 0 && classNames.length <= 3 ? classNames.join(', ') : classCount(classNames.length)}`;
}

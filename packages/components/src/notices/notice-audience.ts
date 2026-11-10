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
  cadets: { label: 'Cadets', description: 'Students, in the Cadet Portal and on WhatsApp.' },
  staff_and_cadets: { label: 'Staff and cadets', description: 'Everyone: staff here, students in the Cadet Portal and on WhatsApp.' },
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

function classCount(count: number) {
  return `${count} ${count === 1 ? 'class' : 'classes'}`;
}

/**
 * One line naming the audience, for lists and summaries: "Staff",
 * "Cadets · All classes", "Staff and cadets · Class 6, Class 7". Class
 * names are listed when known and at most three; otherwise the count.
 */
export function noticeAudienceLabel(facts: NoticeAudienceFacts, classLabels?: ReadonlyMap<string, string>) {
  const { audience } = noticeAudienceSelection(facts);
  const base = NOTICE_AUDIENCE_OPTIONS[audience].label;
  if (facts.cadetScope === 'none') return base;
  if (facts.cadetScope === 'all_classes') return `${base} · All classes`;
  const names = facts.classIds.map((id) => classLabels?.get(id));
  const known = names.every((name): name is string => name !== undefined);
  return `${base} · ${known && names.length > 0 && names.length <= 3 ? names.join(', ') : classCount(facts.classIds.length)}`;
}

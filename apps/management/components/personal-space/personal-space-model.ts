import type { MySchoolDto } from '@campuspilot/api/routers/school/school.dto';
import { SCHOOL_NO_PLAN_REASON, SCHOOL_SUSPENDED_REASON, schoolWriteRefusalOf } from '@campuspilot/api/school-access/school-access.contract';

/**
 * Pure decisions of the personal space screens (docs/personal-space.md), kept
 * apart from the components so they can be tested without a browser. Each
 * reads the school's own `kind` from the school list; nothing here infers a
 * personal space from a name, a missing session or the owner.
 */

type SchoolFacts = Pick<MySchoolDto, 'id' | 'kind'>;

/** Where a personal space opens: its papers. */
export const personalPapersHref = (schoolId: string) => `/school/${encodeURIComponent(schoolId)}/papers`;

/** One standalone paper of a personal space. */
export const personalPaperHref = (schoolId: string, paperId: string) => `${personalPapersHref(schoolId)}/${encodeURIComponent(paperId)}`;

/** The user's personal space among their schools, or undefined when they have none. */
export const personalSpaceOf = <School extends SchoolFacts>(schools: readonly School[]): School | undefined =>
  schools.find((school) => school.kind === 'personal');

/**
 * The school the `/school` entry opens, in this order: the remembered
 * selection when it is still one of the user's schools (of either kind); else
 * the first real school; else the personal space; else none (the "not part of
 * a school yet" page). A school always wins over the personal space unless the
 * user chose the space last.
 */
export function landingSchoolOf<School extends SchoolFacts>(schools: readonly School[], storedSchoolId: string | undefined): School | undefined {
  const stored = storedSchoolId === undefined ? undefined : schools.find((school) => school.id === storedSchoolId);
  if (stored) return stored;
  return schools.find((school) => school.kind === 'school') ?? personalSpaceOf(schools);
}

/** Where a school of the user's list opens: a personal space on its papers, a school on its own entry. */
export const schoolEntryHrefOf = (school: SchoolFacts) =>
  school.kind === 'personal' ? personalPapersHref(school.id) : `/school/${encodeURIComponent(school.id)}`;

/** The website's contact page, which a personal space links to (opened in a new tab). */
export const contactHrefOf = (websiteUrl: string) => new URL('/contact', websiteUrl).toString();

/**
 * What a personal space says about its plan, in its own words: it tells the
 * person to contact CampusPilot (the website's contact page), never to ask
 * an administrator or look for a billing page. `ended` while the space is
 * read-only (suspended, or its trial is over), `ending` in the last days of
 * its coverage, null otherwise. `contact` is the link's text, which says what
 * contacting us is for.
 */
export type PersonalPlanNotice = { kind: 'ended' | 'ending'; message: string; contact: string } | null;

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long before its end the space's coverage is announced (as for schools). */
export const PERSONAL_PLAN_ENDING_DAYS = 7;
const endFormatter = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });

export function personalPlanNoticeOf(
  school: Pick<MySchoolDto, 'isSuspended' | 'hasActivePlan' | 'planEndsAt' | 'planSource'>,
  now: Date = new Date(),
): PersonalPlanNotice {
  if (school.isSuspended) {
    return { kind: 'ended', message: 'Your personal space is suspended. You can still view and download your papers.', contact: 'Contact us to continue' };
  }
  if (!school.hasActivePlan) {
    return { kind: 'ended', message: 'Your free trial has ended. You can still view and download your papers.', contact: 'Contact us to keep creating papers' };
  }
  if (school.planEndsAt === null) return null;
  const end = new Date(school.planEndsAt);
  const left = end.getTime() - now.getTime();
  if (left <= 0 || left > PERSONAL_PLAN_ENDING_DAYS * DAY_MS) return null;
  const message = school.planSource === 'trial' ? `Your free trial ends on ${endFormatter.format(end)}.` : `Your plan runs until ${endFormatter.format(end)}.`;
  return { kind: 'ending', message, contact: 'Contact us to keep creating papers after that' };
}

/** The top bar's short plan status: the trial's end day, or that it ended; null for a paid or standing plan. */
export function personalPlanStatusOf(
  school: Pick<MySchoolDto, 'isSuspended' | 'hasActivePlan' | 'planEndsAt' | 'planSource'>,
): string | null {
  if (school.isSuspended) return 'Suspended';
  if (!school.hasActivePlan) return 'Trial ended';
  if (school.planSource === 'trial' && school.planEndsAt !== null) return `Trial until ${endFormatter.format(new Date(school.planEndsAt))}`;
  return null;
}

/**
 * A refused change in a personal space because it is read-only (its trial
 * ended, or it is suspended), as the space words it beside the action: the
 * same words as its plan notice, with the contact link's text. Decided from
 * the refusal's `data.reason`, never the message. Null for any other error.
 */
export function personalWriteRefusalOf(error: unknown): { message: string; contact: string } | null {
  const reason = schoolWriteRefusalOf(error);
  if (reason === SCHOOL_SUSPENDED_REASON) {
    return { message: 'Your personal space is suspended, so nothing can be changed. You can still view and download your papers.', contact: 'Contact us to continue' };
  }
  if (reason === SCHOOL_NO_PLAN_REASON) {
    return { message: 'Your free trial has ended, so nothing can be changed. You can still view and download your papers.', contact: 'Contact us to keep creating papers' };
  }
  return null;
}

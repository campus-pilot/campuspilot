'use client';

import type { CadetSchoolOption } from '@campuspilot/api/routers/cadet/cadet-school-search.router';
import { Avatar, AvatarFallback, AvatarImage } from '@campuspilot/ui/components/avatar';
import { Combobox } from '@campuspilot/ui/components/combobox';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';

import { orpc } from '@/lib/orpc';

/**
 * Letters a student types before schools are suggested; matches the server's
 * `CADET_SCHOOL_SEARCH_MIN_LENGTH`, which refuses shorter queries.
 */
export const SCHOOL_SEARCH_MIN_LENGTH = 3;

/**
 * Query parameter a school puts in a shared sign-in link
 * (`/sign-in?school=<school code>`) to choose itself in advance.
 */
export const SCHOOL_QUERY_PARAM = 'school';

/** Refetched before the 5-minute presigned logo URL expires. */
const SIGN_IN_SCHOOL_STALE_MS = 4 * 60 * 1_000;

/**
 * The chosen school's public details (name, logo) by its exact code. The
 * combobox and the heading share this query, so one request serves both.
 * `notFound` is its own fact: a shared link may carry a code no school has.
 */
export function useSignInSchool(slug: string) {
  const code = slug.trim();
  const query = useQuery(
    orpc.getSignInSchool.queryOptions({
      input: { slug: code },
      enabled: code.length > 0,
      staleTime: SIGN_IN_SCHOOL_STALE_MS,
    }),
  );
  const notFound = query.isError && (query.error as { code?: string }).code === 'NOT_FOUND';
  return { school: code ? (query.data ?? null) : null, notFound };
}

/**
 * Asks the public `searchSchools` procedure once the trimmed search has
 * {@link SCHOOL_SEARCH_MIN_LENGTH} characters. The previous result stays on
 * screen while the next one loads, so the list does not flash empty on
 * every keystroke; shorter searches show no suggestions at all.
 */
function useSchoolSearch(search: string) {
  const query = search.trim();
  const enabled = query.length >= SCHOOL_SEARCH_MIN_LENGTH;
  const result = useQuery(
    orpc.searchSchools.queryOptions({ input: { query }, enabled, placeholderData: keepPreviousData }),
  );
  return {
    enabled,
    schools: enabled ? (result.data?.schools ?? []) : [],
    isLoading: enabled && result.isPending,
    isError: enabled && result.isError,
  };
}

function emptyMessage({ enabled, isLoading, isError }: ReturnType<typeof useSchoolSearch>) {
  if (!enabled) return `Type at least ${SCHOOL_SEARCH_MIN_LENGTH} letters of your school's name or code.`;
  if (isLoading) return 'Searching…';
  if (isError) return 'Could not search schools. Try again.';
  return 'No school matches. Check the name or the code your school gave you.';
}

/** The school's logo, or its initials when it has none or it fails to load. */
function SchoolLogo({ school, size }: { school: CadetSchoolOption; size: 'sm' | 'default' | 'lg' }) {
  return (
    <Avatar size={size}>
      {school.logoUrl ? <AvatarImage src={school.logoUrl} alt="" /> : null}
      <AvatarFallback className="bg-primary/10 text-[0.625rem] font-semibold text-primary">{initials(school.name)}</AvatarFallback>
    </Avatar>
  );
}

function SchoolOption({ school }: { school: CadetSchoolOption }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <SchoolLogo school={school} size="default" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{school.name}</span>
        <span className="truncate text-muted-foreground">{school.slug}</span>
      </span>
    </span>
  );
}

/** The selected school in the field: a small logo beside its name. */
function SchoolValue({ school }: { school: CadetSchoolOption }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <SchoolLogo school={school} size="sm" />
      <span className="truncate">{school.name}</span>
    </span>
  );
}

type SchoolComboboxProps = {
  id: string;
  /** The chosen school's code, or '' when none is chosen. */
  slug: string;
  search: string;
  invalid: boolean;
  onSlugChange: (slug: string) => void;
  onSearchChange: (search: string) => void;
  onBlur: () => void;
};

/**
 * The sign-in page's school picker: the student types part of the school's
 * name or code and picks one of up to five suggestions. Only the code is
 * stored; the shown name comes from {@link useSignInSchool}, falling back to
 * the code while it loads. A code no school has shows as unselected.
 */
export function SchoolCombobox(props: SchoolComboboxProps) {
  const queryClient = useQueryClient();
  const search = useSchoolSearch(props.search);
  const chosen = useSignInSchool(props.slug);
  /**
   * A suggestion already has everything `getSignInSchool` returns, so it seeds
   * that query: the name and logo appear at once instead of the bare code.
   */
  const choose = (school: CadetSchoolOption | null) => {
    if (school) queryClient.setQueryData(orpc.getSignInSchool.queryKey({ input: { slug: school.slug } }), school);
    props.onSlugChange(school?.slug ?? '');
  };
  const value: CadetSchoolOption | null =
    chosen.school ?? (props.slug && !chosen.notFound ? { slug: props.slug, name: props.slug, logoUrl: null } : null);
  return (
    <Combobox
      id={props.id}
      value={value}
      onValueChange={choose}
      items={search.schools}
      itemKey={(school) => school.slug}
      itemLabel={(school) => school.name}
      renderItem={(school) => <SchoolOption school={school} />}
      renderValue={(school) => <SchoolValue school={school} />}
      search={props.search}
      onSearchChange={props.onSearchChange}
      onSearchBlur={props.onBlur}
      searchLabel="Search schools"
      searchPlaceholder="School name or code…"
      placeholder="Choose your school"
      emptyMessage={emptyMessage(search)}
      aria-invalid={props.invalid}
    />
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');
}

/** The chosen school's logo and name above the sign-in form. */
export function SignInSchoolBadge({ slug }: { slug: string }) {
  const { school } = useSignInSchool(slug);
  if (!school) return null;
  return (
    <div className="flex items-center gap-3">
      <SchoolLogo school={school} size="lg" />
      <p className="min-w-0 truncate text-sm font-medium">{school.name}</p>
    </div>
  );
}

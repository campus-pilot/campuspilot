export type SchoolRouteParams = {
  schoolId: string;
};

export function schoolHref(schoolId: string, suffix = '') {
  return `/school/${encodeURIComponent(schoolId)}${suffix}`;
}

export type SchoolRouteParams = { schoolId: string };

export type SchoolSessionRouteParams = SchoolRouteParams & {
  sessionId: string;
};

export function schoolHref(schoolId: string, suffix = '') {
  return `/school/${encodeURIComponent(schoolId)}${suffix}`;
}

export function schoolSessionHref(
  schoolId: string,
  sessionId: string,
  suffix = '',
) {
  return schoolHref(
    schoolId,
    `/sessions/${encodeURIComponent(sessionId)}${suffix}`,
  );
}

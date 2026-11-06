/**
 * Browser-safe slug helpers shared by the demo dialog and the API. Kept free
 * of Node imports so the admin app can derive the suggested slug client-side.
 */
export const SCHOOL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The URL slug for a school name: lowercase ASCII words joined by hyphens. */
export function slugifySchoolName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

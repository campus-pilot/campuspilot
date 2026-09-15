export const MAX_SCHOOL_LOGO_BYTES = 5 * 1024 * 1024;
export const SCHOOL_LOGO_FIELD_NAME = "logo";

export const SCHOOL_LOGO_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const SCHOOL_LOGO_EXTENSIONS_BY_MIME_TYPE = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
} as const satisfies Record<
  (typeof SCHOOL_LOGO_MIME_TYPES)[number],
  readonly string[]
>;

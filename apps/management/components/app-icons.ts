import type { Metadata } from 'next';

/**
 * CampusPilot's own browser icons. They are configured as metadata rather
 * than `app/` file conventions, because file-based icons apply to every route
 * and could not be cleared for school routes, which show the school's logo.
 */
export const DEFAULT_APP_ICONS = {
  icon: [
    { url: '/favicon.ico', sizes: 'any' },
    { url: '/icon.svg', type: 'image/svg+xml' },
  ],
  apple: '/apple-icon.png',
} satisfies Metadata['icons'];

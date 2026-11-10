"use client";

import { useTheme } from "./theme-provider";

/**
 * Sets the browser and installed-app bar color (`<meta name="theme-color">`)
 * from the app's own light/dark setting, so an installed app's title and
 * status bars match the page instead of a fixed brand color.
 *
 * `resolvedTheme` already maps the "system" choice to the device's scheme, so
 * the bars follow the phone when the user has not picked Light or Dark.
 * Browsers re-read this tag when it changes, so switching the theme recolors
 * the bars immediately, and the tag is React-hoisted into `<head>`.
 *
 * Nothing is rendered until the theme is resolved on the client; until then
 * the web-app manifest's `theme_color` applies.
 */
export function ThemeColorMeta({
  light,
  dark,
}: {
  /** Bar color in light mode, normally the light page background. */
  light: string;
  /** Bar color in dark mode, normally the dark page background. */
  dark: string;
}) {
  const { resolvedTheme } = useTheme();
  if (resolvedTheme !== "light" && resolvedTheme !== "dark") return null;

  return (
    <meta
      name="theme-color"
      content={resolvedTheme === "dark" ? dark : light}
    />
  );
}

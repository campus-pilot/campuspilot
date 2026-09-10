"use client";

import {
  ThemeProvider as NextThemesProvider,
  useTheme,
} from "@campuspilot/ui/lib/theme";
import type { ComponentProps } from "react";

export const CAMPUSPILOT_THEME_STORAGE_KEY = "campuspilot-theme";

export function ThemeProvider({
  children,
  storageKey = CAMPUSPILOT_THEME_STORAGE_KEY,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider storageKey={storageKey} {...props}>
      {children}
    </NextThemesProvider>
  );
}

export { useTheme };

"use client";

import { Button } from "@campuspilot/ui/components/button";
import { Moon, Sun } from "@campuspilot/ui/lib/theme-icons";

import { useTheme } from "./theme-provider";

/**
 * Toggles directly between light and dark. When the saved preference is still
 * "system", the resolved OS theme is treated as the current theme so the first
 * click always moves to the visible opposite.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  const toggleTheme = () => {
    const currentTheme =
      resolvedTheme ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");

    setTheme(currentTheme === "dark" ? "light" : "dark");
  };

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      aria-label="Toggle color theme"
      title="Toggle color theme"
    >
      <Sun className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
    </Button>
  );
}

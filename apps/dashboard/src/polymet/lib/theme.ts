export const WASUP_THEME_STORAGE_KEY = "wasup-theme";

export type WasupTheme = "dark" | "light";

export function getCurrentWasupTheme(): WasupTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyWasupTheme(theme: WasupTheme) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

export function initializeWasupTheme() {
  if (typeof window === "undefined") return;

  const storedTheme = window.localStorage.getItem(WASUP_THEME_STORAGE_KEY);
  applyWasupTheme(storedTheme === "light" ? "light" : "dark");
}

export function persistWasupTheme(theme: WasupTheme) {
  applyWasupTheme(theme);

  if (typeof window === "undefined") return;
  window.localStorage.setItem(WASUP_THEME_STORAGE_KEY, theme);
}

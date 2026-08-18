/**
 * The console's appearance preference, in one place.
 *
 * This logic used to exist in four copies (__root, console shell mount,
 * console useTheme, settings/appearance) and two of them disagreed: the
 * settings page deleted `leenar_theme` for "system" while the shell wrote
 * the literal string, so picking System in settings silently became Dark on
 * the next load. Everything now writes "system" explicitly.
 *
 * The auth pages read this too. `leenar_theme` lives in localStorage and is
 * readable before authentication, so a returning user lands on their own
 * theme while a first-time visitor — who has nothing stored — gets dark,
 * matching the marketing site they arrived from.
 */
export type ThemePref = "system" | "light" | "dark";

const KEY = "leenar_theme";
const VALID: ThemePref[] = ["system", "light", "dark"];

export function resolveTheme(
  pref: ThemePref,
  prefersLight: boolean,
): "light" | "dark" {
  if (pref === "light") return "light";
  if (pref === "dark") return "dark";
  return prefersLight ? "light" : "dark";
}

export function readThemePref(): ThemePref {
  if (typeof localStorage === "undefined") return "dark";
  const raw = localStorage.getItem(KEY);
  return VALID.includes(raw as ThemePref) ? (raw as ThemePref) : "dark";
}

export function writeThemePref(pref: ThemePref): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, pref);
}

function prefersLight(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

function paint(theme: "light" | "dark"): "light" | "dark" {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("light", theme === "light");
  }
  return theme;
}

/** Read the stored preference and put the DOM in that state. */
export function applyStoredTheme(): "light" | "dark" {
  return paint(resolveTheme(readThemePref(), prefersLight()));
}

/** Store a new preference and put the DOM in that state. */
export function setTheme(pref: ThemePref): "light" | "dark" {
  writeThemePref(pref);
  return paint(resolveTheme(pref, prefersLight()));
}

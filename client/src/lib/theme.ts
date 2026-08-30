/**
 * Light / dark theme switching.
 *
 * The app was built dark-only: colours are baked into ~177 Tailwind token
 * usages that resolve at build time. Making them switchable means routing every
 * surface and text colour through CSS variables that a `data-theme` attribute
 * can redefine — the same approach the capability-audit artifact uses.
 *
 * Palette intent: the LIGHT theme is not an inversion. Gold-on-white at the
 * dark theme's saturation reads as muddy yellow, so the accent darkens for
 * contrast on a pale ground while the warm identity is kept. Surfaces stay
 * warm (a cream-tinted white, not clinical #fff) so the two themes feel like
 * the same product.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'bf_theme_v1';

/** Persisted choice; defaults to following the OS. */
export function getStoredChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
  } catch {
    return 'system';
  }
}

/** Persist a choice. Failures are non-fatal — the theme still applies. */
export function storeChoice(choice: ThemeChoice): void {
  try { localStorage.setItem(STORAGE_KEY, choice); } catch { /* private mode */ }
}

/**
 * Resolve a choice to an actual theme.
 * @param choice user selection
 * @param prefersDark what the OS reports; defaults to true so a failed media
 *   query keeps the app on its original dark identity rather than flashing white
 */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === 'light') return 'light';
  if (choice === 'dark') return 'dark';
  return prefersDark ? 'dark' : 'light';
}

/** Does the OS ask for dark? True when the query is unavailable. */
export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

/**
 * Apply a theme to the document.
 *
 * Sets BOTH `data-theme` (for the CSS variable blocks) and `color-scheme` (so
 * OS-drawn controls — select popups, scrollbars, date pickers — match, instead
 * of rendering a white dropdown list on a dark page).
 */
export function applyTheme(theme: ResolvedTheme, root?: HTMLElement): void {
  const el = root || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el) return;
  el.setAttribute('data-theme', theme);
  el.style.colorScheme = theme;
}

/** Read the stored choice, resolve it, and apply. Returns what was applied. */
export function initTheme(): ResolvedTheme {
  const resolved = resolveTheme(getStoredChoice(), systemPrefersDark());
  applyTheme(resolved);
  return resolved;
}

/** Set and persist a choice, applying it immediately. */
export function setTheme(choice: ThemeChoice): ResolvedTheme {
  storeChoice(choice);
  const resolved = resolveTheme(choice, systemPrefersDark());
  applyTheme(resolved);
  return resolved;
}

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveTheme, applyTheme, getStoredChoice, storeChoice, setTheme } from '../theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.colorScheme = '';
});

describe('resolveTheme', () => {
  it('honours an explicit choice regardless of the OS', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the OS when set to system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('stored choice', () => {
  it('defaults to system', () => {
    expect(getStoredChoice()).toBe('system');
  });

  it('round-trips a stored choice', () => {
    storeChoice('light');
    expect(getStoredChoice()).toBe('light');
  });

  it('ignores a corrupt stored value rather than throwing', () => {
    localStorage.setItem('bf_theme_v1', 'banana');
    expect(getStoredChoice()).toBe('system');
  });
});

describe('applyTheme', () => {
  it('sets data-theme so the CSS variable blocks take effect', () => {
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('sets color-scheme so OS-drawn controls match', () => {
    // Without this a native <select> popup renders white-on-white in dark mode.
    applyTheme('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('switching replaces the previous theme rather than stacking', () => {
    applyTheme('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

describe('setTheme', () => {
  it('persists and applies in one step', () => {
    setTheme('light');
    expect(getStoredChoice()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// CALM — third theme (2026-09-17).
//
// Added because the gold dark theme "looks too deep and not helpful at night".
// Calm is a real choice, never a system resolution: `system` must keep meaning
// light-or-dark, so someone who picked Calm keeps it regardless of the OS.
// ---------------------------------------------------------------------------

describe('calm theme', () => {
  it('is a selectable choice that resolves to itself', () => {
    expect(resolveTheme('calm', true)).toBe('calm');
    expect(resolveTheme('calm', false)).toBe('calm');
  });

  it('is never produced by following the system', () => {
    // The OS only reports light/dark, so `system` must never land on calm.
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('survives a round trip through storage', () => {
    storeChoice('calm');
    expect(getStoredChoice()).toBe('calm');
  });

  it('applies data-theme="calm" and a dark color-scheme', () => {
    const el = document.createElement('div');
    applyTheme('calm', el);
    expect(el.getAttribute('data-theme')).toBe('calm');
    // Calm is a dark-ground theme, so OS-drawn controls must render dark or
    // select popups come back white on a dark page.
    expect(el.style.colorScheme).toBe('dark');
  });

  it('does not disturb light and dark', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

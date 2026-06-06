// Canonical text-layout options for the kinetic caption renderer. The `value`s
// MUST match the server's videoFilters.js `listLayouts()` set — the render
// pipeline resolves unknown values to "center". Shared by the Render page and
// Sermon Clip Studio so the two pickers never drift.

export interface LayoutOption {
  value: string;
  label: string;
}

export const LAYOUT_OPTIONS: LayoutOption[] = [
  { value: 'center', label: 'Center (default)' },
  { value: 'center-large', label: 'Center — large' },
  { value: 'bottom-center', label: 'Bottom center' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'staggered', label: 'Staggered' },
];

export const LAYOUT_VALUES: string[] = LAYOUT_OPTIONS.map((o) => o.value);

export const DEFAULT_LAYOUT = 'center';

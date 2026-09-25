/**
 * Story-page form vocabulary, built on the theme-aware primitives in
 * index.css (`.field-label`, `.input`, `.btn-*`) and the `bf-*` tokens.
 *
 * The Story forms used to carry dark-mode literals (`border-white/10`,
 * `text-gray-300`) — invisible on the light theme, which is what the phone
 * renders: fields with no edges, labels that vanish. Everything here resolves
 * through CSS variables so both themes get real borders and legible labels.
 */

/** Bold, small label above a field. */
export const fieldLabelCls = 'field-label';

/** Text input / select / textarea. */
export const inputCls = 'input mt-1.5';

/** Gold gradient primary action. */
export const primaryBtnCls = 'btn btn-primary gap-2';

/** Hairline secondary action. */
export const secondaryBtnCls = 'btn btn-secondary gap-2';

/** Bordered inner panel (a section of a form, a recovery row, a done card). */
export const panelCls = 'rounded-2xl border border-[rgba(216,184,120,0.18)] bg-bf-card2/60 p-3.5 sm:p-4';

/** Softer info/status row (busy states). */
export const statusRowCls = 'rounded-2xl border border-[rgba(216,184,120,0.28)] bg-[rgba(216,184,120,0.08)] px-4 py-3';

/** Segmented control container (Upload audio | Write a script | Long-form). */
export const segmentedCls = 'inline-flex rounded-xl border border-[rgba(216,184,120,0.22)] bg-bf-card2/70 p-1 text-sm';

/** One segment; the active one gets the gold fill. */
export function segmentCls(active: boolean): string {
  return `rounded-lg px-3 py-1.5 font-medium transition-colors ${
    active
      ? 'bg-bf-gold text-bf-bg shadow-sm'
      : 'text-bf-sub hover:text-bf-cream'
  }`;
}

/** Dashed drop target. */
export const dropZoneCls = 'flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[rgba(216,184,120,0.3)] bg-bf-card2/40 px-4 py-6 text-sm font-medium text-bf-sub transition-colors hover:border-bf-goldDeep hover:text-bf-cream';

/** Small eyebrow caption (gold, tracked). */
export const eyebrowCls = 'bf-eyebrow';

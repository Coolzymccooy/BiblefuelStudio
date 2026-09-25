export type TrackListVariant = 'full' | 'compact';

// Full: grip, art, title, licence, time, menu on a phone; number and credit
// columns join from md up. Compact: one row that fits a side panel.
const FULL_COLS = 'grid-cols-[16px_32px_minmax(0,1fr)_auto_44px_28px] md:grid-cols-[16px_22px_36px_minmax(0,1fr)_minmax(0,200px)_88px_56px_28px]';
const COMPACT_COLS = 'grid-cols-[14px_30px_minmax(0,1fr)_auto_38px_26px]';

/** The column template shared by the header row and every track row. */
export const trackGridCols = (variant: TrackListVariant) => (variant === 'full' ? FULL_COLS : COMPACT_COLS);
